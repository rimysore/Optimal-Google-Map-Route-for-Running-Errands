
import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from '@google/genai';
import { 
  MapPin, 
  Mic, 
  MicOff, 
  Navigation, 
  Clock, 
  Car, 
  Users, 
  ShoppingBag, 
  Search, 
  ExternalLink,
  Loader2,
  Trash2,
  Plus,
  RefreshCw,
  BrainCircuit,
  AlertTriangle,
  History,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';

// Interfaces for structured spatial data
interface ErrandStop {
  id: string;
  name: string;
  address: string;
  category: string;
  reason: string;
  arrivalEstimate: string;
  parkingDifficulty: 'Easy' | 'Moderate' | 'Difficult';
  crowdLevel: 'Low' | 'Medium' | 'High';
  googleMapsUrl: string;
  parkingAdvice?: string;
  trafficNote?: string;
}

interface ErrandPlan {
  summary: string;
  stops: ErrandStop[];
  totalTime: string;
  efficiencyScore: number;
  alternatives?: { original: string; suggested: string; benefit: string }[];
  householdSuggestions?: string[];
  reasoning: string;
}

interface GroundingLink {
  title: string;
  uri: string;
}

const ErrandOptimizer = () => {
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [plan, setPlan] = useState<ErrandPlan | null>(null);
  const [groundingLinks, setGroundingLinks] = useState<GroundingLink[]>([]);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationName, setLocationName] = useState('Detecting location...');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  const recognitionRef = useRef<any>(null);

  // Core setup: Speech & Location
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput((prev) => (prev ? `${prev}, ${transcript}` : transcript));
        setIsListening(false);
      };

      recognitionRef.current.onerror = () => {
        setIsListening(false);
        setError('Voice recognition error. Check microphone settings.');
      };
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setLocation(coords);
          setLocationName(`${coords.lat.toFixed(3)}, ${coords.lng.toFixed(3)}`);
        },
        () => {
          setError('Location access denied. Routing from default hub (San Francisco).');
          setLocation({ lat: 37.7749, lng: -122.4194 });
          setLocationName('San Francisco, CA');
        }
      );
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      setError(null);
      try {
        recognitionRef.current?.start();
        setIsListening(true);
      } catch (e) {
        setError('Microphone access is unavailable.');
      }
    }
  };

  const generatePlan = async (isReroute = false) => {
    if (!input.trim() && !isReroute) return;
    setIsLoading(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
      
      const prompt = `
        User Request: "${input}"
        Origin Coords: ${location?.lat}, ${location?.lng}
        Current Time: ${new Date().toLocaleTimeString()}
        Operational Mode: ${isReroute ? "REROUTE (Dynamic adjustment for traffic and business closures)" : "PLAN_INIT"}

        Act as ErrandOS, a high-performance spatial intelligence engine. 
        Perform these steps:
        1. Find the best physical locations for the requested errands using Google Maps tool.
        2. Sequence them for maximum fuel/time efficiency (Traveling Salesman optimization).
        3. Assess parking and crowd density based on the current time of day.
        4. Suggest household coordination: which items could be handled by another family member.
        5. Provide a deep reasoning for the specific order chosen.

        Return strictly valid JSON in this format:
        {
          "summary": "Concise summary",
          "stops": [{
            "id": "unique_id",
            "name": "Exact Business Name",
            "address": "Street, City",
            "category": "e.g., Grocery",
            "reason": "Why this location was picked",
            "arrivalEstimate": "Expected time",
            "parkingDifficulty": "Easy/Moderate/Difficult",
            "crowdLevel": "Low/Medium/High",
            "googleMapsUrl": "maps_link",
            "parkingAdvice": "Specific spot tips",
            "trafficNote": "Specific delay notes"
          }],
          "totalTime": "Duration string",
          "efficiencyScore": 0-100,
          "alternatives": [{ "original": "target", "suggested": "optimized choice", "benefit": "e.g., saves 10 mins" }],
          "householdSuggestions": ["Strategy for family help"],
          "reasoning": "Spatial logic walkthrough"
        }
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          tools: [{ googleMaps: {} }],
          toolConfig: {
            retrievalConfig: {
              latLng: {
                latitude: location?.lat || 37.7749,
                longitude: location?.lng || -122.4194
              }
            }
          }
        },
      });

      const text = response.text || '';
      // Sanitize AI response for valid JSON
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}') + 1;
      const jsonString = text.substring(jsonStart, jsonEnd);
      
      if (!jsonString) throw new Error("Critical: AI response contained no valid plan data.");
      
      const parsedPlan: ErrandPlan = JSON.parse(jsonString);
      
      // Collect grounded sources
      const sources: GroundingLink[] = [];
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (Array.isArray(chunks)) {
        chunks.forEach((chunk: any) => {
          if (chunk?.maps?.title && chunk?.maps?.uri) {
            sources.push({ 
              title: String(chunk.maps.title), 
              uri: String(chunk.maps.uri) 
            });
          }
        });
      }

      setPlan(parsedPlan);
      setGroundingLinks(sources);
      if (!isReroute) setHistory(prev => [input, ...prev].slice(0, 5));
    } catch (err: any) {
      console.error(err);
      setError('Spatial processing interrupted. Verify errand descriptions and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const getMultiStopMapsUrl = () => {
    if (!plan || !plan.stops) return '#';
    const base = 'https://www.google.com/maps/dir/';
    const start = `${location?.lat},${location?.lng}/`;
    const stopsStr = plan.stops.map(s => encodeURIComponent(String(s.address))).join('/');
    return `${base}${start}${stopsStr}`;
  };

  // Safe rendering helper to prevent React rendering errors with objects
  const renderVal = (val: any) => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  };

  return (
    <div className="min-h-screen bg-[#06080a] text-slate-100 font-sans selection:bg-indigo-500/30 overflow-x-hidden">
      {/* Dynamic Header */}
      <header className="border-b border-white/5 bg-[#0a0c10]/95 backdrop-blur-2xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(79,70,229,0.3)] border border-white/10 group transition-all hover:scale-105">
              <Navigation className="text-white w-6 h-6 group-hover:rotate-12 transition-transform" />
            </div>
            <div>
              <h1 className="font-black text-2xl tracking-tighter uppercase italic leading-none">
                Errand<span className="text-indigo-500 not-italic font-light">OS</span>
              </h1>
              <div className="flex items-center gap-2 text-[9px] text-slate-500 font-bold tracking-[0.2em] uppercase mt-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Hub Connection
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="hidden lg:flex flex-col items-end">
              <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Active Coordinate</span>
              <span className="text-xs font-mono text-slate-400">{locationName}</span>
            </div>
            <div className="w-px h-8 bg-white/5" />
            <button className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl transition-all border border-white/5">
              <History className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-10">
        
        {/* Input & Intelligence Config (Left) */}
        <div className="lg:col-span-4 space-y-8">
          <section className="bg-slate-900/40 p-7 rounded-[2.5rem] border border-white/5 shadow-2xl relative overflow-hidden group">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-indigo-500/10 blur-[60px] rounded-full group-hover:bg-indigo-500/20 transition-all duration-700" />
            
            <div className="flex items-center justify-between mb-6 relative z-10">
              <h2 className="text-xs font-black text-indigo-400 uppercase tracking-widest">Mission Protocol</h2>
              <BrainCircuit className="w-4 h-4 text-slate-600" />
            </div>
            
            <div className="relative mb-6 z-10">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Where do we need to go today?"
                className="w-full bg-black/40 border border-white/10 rounded-3xl p-6 text-lg min-h-[180px] focus:ring-2 focus:ring-indigo-500/30 transition-all outline-none resize-none placeholder:text-slate-800 font-medium text-slate-200"
              />
              <button
                onClick={toggleListening}
                className={`absolute right-5 bottom-5 p-4 rounded-2xl transition-all shadow-xl group/btn ${
                  isListening ? 'bg-red-600 scale-110 shadow-red-600/20' : 'bg-indigo-600 hover:scale-105 shadow-indigo-600/20'
                } text-white`}
              >
                {isListening ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6 group-hover/btn:scale-110 transition-transform" />}
              </button>
            </div>

            <button
              onClick={() => generatePlan()}
              disabled={isLoading || !input.trim()}
              className="w-full bg-white text-black py-5 rounded-[2rem] font-black text-sm uppercase tracking-widest transition-all shadow-2xl flex items-center justify-center gap-3 hover:bg-slate-200 active:scale-[0.98] disabled:opacity-20 relative z-10"
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Navigation className="w-5 h-5" />}
              Initialize Optimization
            </button>
          </section>

          {/* History / Quick-Fill */}
          {history.length > 0 && (
            <section className="space-y-4 px-2">
              <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Recent Sequences</h3>
              <div className="space-y-2">
                {history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(h)}
                    className="w-full text-left bg-white/5 hover:bg-white/10 border border-white/5 p-4 rounded-2xl transition-all text-xs font-semibold text-slate-400 truncate"
                  >
                    {h}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Results & Mapping (Right) */}
        <div className="lg:col-span-8 space-y-10 pb-20">
          {error && (
            <div className="bg-red-950/20 border border-red-500/20 text-red-400 p-8 rounded-[2.5rem] flex items-start gap-5 animate-in fade-in zoom-in">
              <AlertTriangle className="w-7 h-7 shrink-0" />
              <div>
                <p className="font-bold text-lg">System Conflict</p>
                <p className="text-sm opacity-80 mt-1">{error}</p>
              </div>
            </div>
          )}

          {plan ? (
            <div className="space-y-10 animate-in fade-in slide-in-from-bottom-10 duration-700">
              
              {/* Trip Highlights */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 bg-indigo-600 p-8 rounded-[3rem] shadow-[0_20px_50px_rgba(79,70,229,0.3)] text-white relative overflow-hidden">
                  <div className="absolute -right-10 -top-10 opacity-10 rotate-12">
                    <Navigation className="w-64 h-64" />
                  </div>
                  <div className="relative z-10">
                    <p className="text-[10px] font-black uppercase tracking-[0.4em] opacity-60 mb-2">Operation Window</p>
                    <h2 className="text-6xl font-black italic tracking-tighter mb-6">{renderVal(plan.totalTime)}</h2>
                    <div className="flex flex-wrap gap-4">
                      <div className="bg-black/20 backdrop-blur-xl px-5 py-2.5 rounded-full text-xs font-black border border-white/10 flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5" /> {renderVal(plan.stops.length)} LOCATIONS
                      </div>
                      <div className="bg-black/20 backdrop-blur-xl px-5 py-2.5 rounded-full text-xs font-black border border-white/10 flex items-center gap-2">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> {renderVal(plan.efficiencyScore)}% OPTIMIZED
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <a
                    href={getMultiStopMapsUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 bg-white text-black px-8 py-6 rounded-[2.5rem] flex items-center justify-center gap-3 font-black text-sm uppercase tracking-widest shadow-xl hover:bg-slate-200 transition-colors"
                  >
                    <ExternalLink className="w-5 h-5" />
                    Launch GPS
                  </a>
                  <button
                    onClick={() => generatePlan(true)}
                    className="flex-1 bg-slate-900 text-white border border-white/10 px-8 py-6 rounded-[2.5rem] flex items-center justify-center gap-3 font-black text-sm uppercase tracking-widest hover:bg-slate-800 transition-colors"
                  >
                    <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
                    Live Reroute
                  </button>
                </div>
              </div>

              {/* Itinerary Timeline */}
              <div className="space-y-6">
                <h3 className="text-sm font-black text-slate-500 uppercase tracking-[0.3em] px-4">Itinerary Sequence</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {plan.stops.map((stop, index) => (
                    <div key={stop.id} className="bg-slate-900/30 border border-white/5 p-7 rounded-[2.5rem] hover:bg-slate-900/60 transition-all hover:border-white/10 group">
                      <div className="flex items-start justify-between mb-6">
                        <div className="w-12 h-12 bg-slate-800 rounded-2xl flex items-center justify-center text-sm font-black text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                          {index + 1}
                        </div>
                        <div className="text-right">
                          <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest block mb-1">Estimated Slot</span>
                          <span className="text-base font-black text-slate-100">{renderVal(stop.arrivalEstimate)}</span>
                        </div>
                      </div>
                      
                      <h4 className="text-2xl font-black text-white leading-none mb-2">{renderVal(stop.name)}</h4>
                      <p className="text-xs text-slate-500 font-bold mb-6 tracking-wide line-clamp-1 italic">{renderVal(stop.address)}</p>
                      
                      <div className="grid grid-cols-2 gap-3 mb-6">
                        <div className="bg-black/20 p-4 rounded-2xl border border-white/5 flex flex-col justify-center">
                          <p className="text-[9px] font-black text-slate-600 uppercase mb-1">Parking Intel</p>
                          <p className={`text-xs font-black ${stop.parkingDifficulty === 'Easy' ? 'text-emerald-400' : 'text-amber-500'}`}>
                            {renderVal(stop.parkingDifficulty)}
                          </p>
                        </div>
                        <div className="bg-black/20 p-4 rounded-2xl border border-white/5 flex flex-col justify-center">
                          <p className="text-[9px] font-black text-slate-600 uppercase mb-1">Crowd Density</p>
                          <p className={`text-xs font-black ${stop.crowdLevel === 'Low' ? 'text-emerald-400' : 'text-amber-500'}`}>
                            {renderVal(stop.crowdLevel)}
                          </p>
                        </div>
                      </div>

                      {stop.trafficNote && (
                        <div className="mb-4 bg-red-500/10 border border-red-500/10 p-3 rounded-xl text-[10px] font-bold text-red-400 flex items-center gap-2">
                          <AlertTriangle className="w-3 h-3" /> {renderVal(stop.trafficNote)}
                        </div>
                      )}

                      <div className="bg-indigo-500/5 p-5 rounded-2xl border border-indigo-500/10 text-xs font-medium text-slate-400 leading-relaxed">
                        <span className="text-indigo-400 font-black text-[10px] uppercase block mb-1 tracking-widest">Navigator Protocol</span>
                        {renderVal(stop.parkingAdvice || stop.reason)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Spatial Intelligence Report */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                
                {/* Reasoning / The Brain */}
                <div className="lg:col-span-8 bg-[#12161b] p-10 rounded-[3.5rem] border border-white/5 space-y-8 relative overflow-hidden">
                  <div className="absolute right-0 top-0 p-10 opacity-5">
                    <BrainCircuit className="w-40 h-40" />
                  </div>
                  <div className="flex items-center gap-4 relative z-10">
                    <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center">
                      <BrainCircuit className="w-6 h-6 text-indigo-400" />
                    </div>
                    <h3 className="text-base font-black text-white uppercase tracking-[0.4em]">Spatial Intelligence Logic</h3>
                  </div>
                  <p className="text-base text-slate-400 leading-relaxed font-medium bg-black/40 p-8 rounded-[2.5rem] border border-white/5 italic relative z-10">
                    "{renderVal(plan.reasoning)}"
                  </p>
                  
                  {plan.householdSuggestions && plan.householdSuggestions.length > 0 && (
                    <div className="space-y-5 relative z-10">
                      <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-widest flex items-center gap-2">
                        <Users className="w-3.5 h-3.5" /> Unit Task Coordination
                      </h4>
                      <div className="flex flex-wrap gap-3">
                        {plan.householdSuggestions.map((s, i) => (
                          <div key={i} className="bg-indigo-600/10 text-indigo-400 text-[11px] font-black px-5 py-3 rounded-2xl border border-indigo-500/20 shadow-xl">
                            {renderVal(s)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Verification / Sources */}
                <div className="lg:col-span-4 bg-black/40 p-10 rounded-[3.5rem] border border-white/5 flex flex-col h-full">
                  <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] mb-8">Verified Signals</h3>
                  <div className="space-y-4 flex-1">
                    {groundingLinks.length > 0 ? groundingLinks.map((link, i) => (
                      <a
                        key={i}
                        href={link.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 transition-all group"
                      >
                        <span className="text-[11px] font-bold text-slate-300 truncate pr-4">{renderVal(link.title)}</span>
                        <ExternalLink className="w-4 h-4 text-slate-700 group-hover:text-indigo-400 transition-colors shrink-0" />
                      </a>
                    )) : (
                      <div className="flex flex-col items-center justify-center py-10 opacity-20 text-center">
                        <ShieldCheck className="w-10 h-10 mb-2" />
                        <p className="text-[10px] font-black uppercase">Internal DB Only</p>
                      </div>
                    )}
                  </div>
                  <div className="mt-8 pt-8 border-t border-white/5">
                    <p className="text-[9px] font-black text-slate-700 uppercase tracking-[0.4em] text-center">Data Integrity High</p>
                  </div>
                </div>
              </div>

              {/* Alternatives / Smart Suggestions */}
              {plan.alternatives && plan.alternatives.length > 0 && (
                <div className="bg-emerald-500/5 border border-emerald-500/20 p-8 rounded-[3rem] animate-in fade-in slide-in-from-bottom-5">
                  <h3 className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                    <Plus className="w-4 h-4" /> Strategic Itinerary Alternatives
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {plan.alternatives.map((alt, i) => (
                      <div key={i} className="bg-black/40 p-5 rounded-2xl border border-white/5">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] font-black text-slate-600 line-through truncate">{renderVal(alt.original)}</span>
                          <ChevronRight className="w-3 h-3 text-slate-700" />
                          <span className="text-xs font-black text-emerald-400 truncate">{renderVal(alt.suggested)}</span>
                        </div>
                        <p className="text-[11px] font-medium text-slate-400 leading-snug">{renderVal(alt.benefit)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          ) : !isLoading && (
            <div className="h-full min-h-[500px] flex flex-col items-center justify-center py-20 text-center space-y-8 animate-in fade-in duration-1000">
              <div className="relative group">
                <div className="absolute inset-0 bg-indigo-500/10 blur-[100px] rounded-full group-hover:bg-indigo-500/20 transition-all duration-1000" />
                <div className="w-32 h-32 bg-slate-900 rounded-[3rem] flex items-center justify-center border border-white/10 shadow-3xl relative z-10 overflow-hidden">
                  <Navigation className="w-12 h-12 text-slate-700 group-hover:text-indigo-500 transition-colors" />
                </div>
              </div>
              <div className="max-w-md">
                <h2 className="text-4xl font-black text-white italic uppercase tracking-tighter mb-4">Awaiting Itinerary</h2>
                <p className="text-slate-600 text-base font-medium leading-relaxed">
                  Provide your target locations or errands. ErrandOS will synthesize a multi-stop routing strategy optimized for your specific geolocation and timeframe.
                </p>
              </div>
              <div className="flex gap-4 opacity-50">
                <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/5 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  <Car className="w-3 h-3" /> Auto Sync
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/5 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  <Clock className="w-3 h-3" /> Real-Time
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Persistent UI elements */}
      <div className="fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#06080a] to-transparent pointer-events-none z-40" />
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<ErrandOptimizer />);
}
