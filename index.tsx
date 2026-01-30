
import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from '@google/genai';
import { 
  MapPin, 
  Mic, 
  MicOff, 
  Navigation, 
  Search, 
  ExternalLink,
  Loader2,
  RefreshCw,
  BrainCircuit,
  AlertTriangle,
  History,
  Settings
} from 'lucide-react';

// --- Types ---
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

// --- Utilities ---
const renderVal = (val: any) => {
  if (val === undefined || val === null) return '';
  return String(val);
};

const extractJSON = (text: string) => {
  try {
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonStart = cleanText.indexOf('{');
    const jsonEnd = cleanText.lastIndexOf('}') + 1;
    if (jsonStart === -1 || jsonEnd === 0) return null;
    return JSON.parse(cleanText.substring(jsonStart, jsonEnd));
  } catch (e) {
    console.error("JSON Extraction Error:", e);
    return null;
  }
};

const ErrandOS = () => {
  // App State
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [plan, setPlan] = useState<ErrandPlan | null>(null);
  const [groundingLinks, setGroundingLinks] = useState<GroundingLink[]>([]);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationName, setLocationName] = useState('Locating...');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  const recognitionRef = useRef<any>(null);

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
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const prompt = `
        User Request: "${input}"
        Origin Coords: ${location?.lat}, ${location?.lng}
        Current Time: ${new Date().toLocaleTimeString()}
        Operational Mode: ${isReroute ? "REROUTE" : "PLAN_INIT"}

        Task: Optimize a multi-stop errand trip. 
        1. Use Google Maps to find exact business names and addresses.
        2. Sequence them to minimize total driving time.
        3. Include parking difficulty (Easy/Moderate/Difficult) and crowd levels (Low/Medium/High).
        4. Suggest household coordination.

        IMPORTANT: Return ONLY a JSON object. No markdown, no conversational filler.
        Format:
        {
          "summary": "trip summary",
          "stops": [{ "id": "1", "name": "Store", "address": "Address", "category": "Type", "reason": "why", "arrivalEstimate": "HH:MM AM/PM", "parkingDifficulty": "Easy", "crowdLevel": "Low", "googleMapsUrl": "url", "parkingAdvice": "tips", "trafficNote": "notes" }],
          "totalTime": "string",
          "efficiencyScore": 95,
          "alternatives": [],
          "householdSuggestions": ["suggestion"],
          "reasoning": "spatial logic"
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

      const parsedPlan = extractJSON(response.text);
      
      if (!parsedPlan) {
        throw new Error("Critical: AI response contained no valid plan data. Please try again with more specific details.");
      }
      
      const sources: GroundingLink[] = [];
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (Array.isArray(chunks)) {
        chunks.forEach((chunk: any) => {
          if (chunk?.maps?.uri) {
            sources.push({ 
              title: String(chunk.maps.title || 'Map Location'), 
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
      setError(err.message || 'Spatial processing interrupted.');
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

  return (
    <div className="min-h-screen bg-[#06080a] text-slate-100 font-sans selection:bg-indigo-500/30 overflow-x-hidden">
      <header className="border-b border-white/5 bg-[#0a0c10]/95 backdrop-blur-2xl sticky top-0 z-50 px-safe-top">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg border border-white/10">
              <Navigation className="text-white w-5 h-5" />
            </div>
            <div>
              <h1 className="font-black text-xl tracking-tighter uppercase italic leading-none">
                Errand<span className="text-indigo-500 not-italic font-light">OS</span>
              </h1>
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-1">Autonomous Optimizer</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end mr-2">
              <span className="text-xs font-bold text-slate-200">System Active</span>
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{locationName}</span>
            </div>
            <button className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl transition-all border border-white/5 group">
              <Settings className="w-5 h-5 text-slate-400 group-hover:rotate-45 transition-transform" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 pb-32">
        <div className="lg:col-span-4 space-y-6">
          <section className="bg-slate-900/40 p-6 rounded-[2rem] border border-white/5 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 blur-[60px]" />
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">New Mission</h2>
              <BrainCircuit className="w-4 h-4 text-slate-700" />
            </div>
            <div className="relative mb-6">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="List your errands (e.g., groceries, pharmacy, coffee...)"
                className="w-full bg-black/40 border border-white/10 rounded-2xl p-5 text-base min-h-[140px] focus:ring-2 focus:ring-indigo-500/30 transition-all outline-none resize-none font-medium text-slate-200"
              />
              <button
                onClick={toggleListening}
                className={`absolute right-4 bottom-4 p-3.5 rounded-xl transition-all ${
                  isListening ? 'bg-red-600 animate-pulse' : 'bg-indigo-600 shadow-[0_0_20px_rgba(79,70,229,0.4)]'
                } text-white`}
              >
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
            </div>
            <button
              onClick={() => generatePlan()}
              disabled={isLoading || !input.trim()}
              className="w-full bg-white text-black py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-xl flex items-center justify-center gap-2 hover:bg-slate-200 disabled:opacity-20 active:scale-[0.98]"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Calculate Logistics
            </button>
          </section>

          {history.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-2 flex items-center gap-2">
                <History className="w-3 h-3" /> Log History
              </h3>
              {history.map((h, i) => (
                <button 
                  key={i} 
                  onClick={() => setInput(h)}
                  className="w-full bg-white/5 hover:bg-white/10 p-4 rounded-2xl border border-white/5 text-left text-xs text-slate-400 truncate font-semibold transition-all hover:translate-x-1"
                >
                  {h}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-8 space-y-8">
          {error && (
            <div className="bg-red-950/20 border border-red-500/20 text-red-400 p-6 rounded-[2rem] flex items-center gap-4">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <p className="text-xs font-bold uppercase tracking-wide">{error}</p>
            </div>
          )}

          {plan ? (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1 bg-indigo-600 p-7 rounded-[2.5rem] text-white flex flex-col justify-center shadow-2xl relative overflow-hidden group">
                  <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] opacity-60 mb-1">Time Investment</p>
                  <h2 className="text-4xl font-black italic tracking-tighter">{renderVal(plan.totalTime)}</h2>
                </div>
                <div className="flex gap-4">
                   <a
                    href={getMultiStopMapsUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="aspect-square bg-white text-black p-6 rounded-[2rem] flex flex-col items-center justify-center gap-2 group hover:bg-slate-200 transition-all shadow-xl active:scale-95"
                  >
                    <ExternalLink className="w-6 h-6 group-hover:scale-110 transition-transform" />
                    <span className="text-[9px] font-black uppercase tracking-widest">Deploy GPS</span>
                  </a>
                  <button
                    onClick={() => generatePlan(true)}
                    className="aspect-square bg-slate-900 border border-white/10 text-white p-6 rounded-[2rem] flex flex-col items-center justify-center gap-2 hover:bg-slate-800 transition-all active:scale-95"
                  >
                    <RefreshCw className={`w-6 h-6 ${isLoading ? 'animate-spin' : ''}`} />
                    <span className="text-[9px] font-black uppercase tracking-widest">Update</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {plan.stops.map((stop, idx) => (
                  <div key={idx} className="bg-slate-900/40 border border-white/5 p-6 rounded-[2.5rem] space-y-4 hover:border-indigo-500/20 transition-all group">
                    <div className="flex justify-between items-start">
                      <div className="bg-slate-800 w-10 h-10 rounded-xl flex items-center justify-center text-xs font-black text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                        0{idx + 1}
                      </div>
                      <div className="bg-indigo-500/10 px-3 py-1.5 rounded-lg border border-indigo-500/20">
                        <span className="text-[10px] font-black text-indigo-300 uppercase">{renderVal(stop.arrivalEstimate)}</span>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xl font-black text-white">{renderVal(stop.name)}</h4>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight line-clamp-1">{renderVal(stop.address)}</p>
                    </div>
                    <div className="flex gap-2">
                       <span className="text-[8px] bg-slate-800 px-2 py-1 rounded text-slate-400 font-black uppercase tracking-widest">{renderVal(stop.parkingDifficulty)} Park</span>
                       <span className="text-[8px] bg-slate-800 px-2 py-1 rounded text-slate-400 font-black uppercase tracking-widest">{renderVal(stop.crowdLevel)} Crowd</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed italic border-l-2 border-indigo-500/30 pl-3 group-hover:border-indigo-500 transition-all">
                      {renderVal(stop.parkingAdvice || stop.reason)}
                    </p>
                  </div>
                ))}
              </div>

              {groundingLinks.length > 0 && (
                <div className="bg-slate-900/40 border border-white/5 p-6 rounded-[2.5rem]">
                   <div className="flex items-center gap-3 mb-4">
                    <MapPin className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-[10px] font-black text-white uppercase tracking-[0.3em]">Operational Data Sources</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {groundingLinks.map((link, i) => (
                      <a 
                        key={i} 
                        href={link.uri} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-[9px] bg-white/5 hover:bg-indigo-500/10 px-3 py-1.5 rounded-full border border-white/10 text-slate-400 hover:text-indigo-300 font-black uppercase transition-all flex items-center gap-2"
                      >
                        {link.title} <ExternalLink className="w-3 h-3" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-[#12161b] p-8 rounded-[3rem] border border-white/5 shadow-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <BrainCircuit className="w-5 h-5 text-indigo-500" />
                  <h3 className="text-[10px] font-black text-white uppercase tracking-[0.3em]">Strategy Analysis</h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed font-medium mb-6">
                  {renderVal(plan.reasoning)}
                </p>
                {plan.householdSuggestions && (
                  <div className="flex flex-wrap gap-2">
                    {plan.householdSuggestions.map((s, i) => (
                      <span key={i} className="text-[9px] bg-indigo-500/10 text-indigo-300 px-3 py-1.5 rounded-full border border-indigo-500/10 font-black uppercase">
                        {renderVal(s)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : !isLoading && (
            <div className="py-20 text-center flex flex-col items-center opacity-30 animate-pulse">
               <div className="w-20 h-20 bg-slate-800 rounded-[2rem] flex items-center justify-center mb-6">
                 <Navigation className="w-8 h-8 text-indigo-500" />
               </div>
               <p className="text-xs font-black uppercase tracking-[0.4em] text-slate-500">Awaiting Mission Directives</p>
            </div>
          )}
        </div>
      </main>

      {/* Mobile Floating Mic */}
      {!isLoading && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 lg:hidden z-50">
           <button 
            onClick={toggleListening}
            className={`w-16 h-16 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(79,70,229,0.3)] text-white transition-all active:scale-90 ${
              isListening ? 'bg-red-600 scale-110 animate-pulse' : 'bg-indigo-600'
            }`}
           >
             {isListening ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
           </button>
        </div>
      )}
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<ErrandOS />);
}
