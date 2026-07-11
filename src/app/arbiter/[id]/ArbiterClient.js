"use client";

import { useState, useEffect } from 'react';
import { Swords, CheckCircle2, AlertTriangle, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import Lightswitch from '@/components/layout/LightSwitch';

const RESULT_OPTIONS = [
  { value: '1-0', label: '1 - 0' },
  { value: '0-1', label: '0 - 1' },
  { value: '0.5-0.5', label: '½ - ½' },
  { value: '0-0', label: '0 - 0' },
  { value: '1-0f', label: '+ : - (Forfeit)' },
  { value: '0-1f', label: '- : + (Forfeit)' },
  { value: '', label: 'Pending' },
];

export default function ArbiterClient({ sessionId }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [selectedRoundIndex, setSelectedRoundIndex] = useState(0);

  useEffect(() => {
    fetchSession();
    // Poll for updates in case pairings change, but mostly we just need it initially
    const interval = setInterval(() => {
      // Don't fetch if there's already a fatal error like session closed
      if (!error) {
        fetchSession();
      }
    }, 10000);
    
    return () => clearInterval(interval);
  }, [sessionId, error]);

  const fetchSession = async () => {
    try {
      const res = await fetch(`/api/arbiter/session/${sessionId}`, { cache: 'no-store' });
      if (!res.ok) {
        if (res.status === 404) {
          setError('Session closed or expired.');
        } else {
          setError('Failed to fetch session.');
        }
        setLoading(false);
        return;
      }
      
      const data = await res.json();
      setSession(prev => {
         setSelectedRoundIndex(currentIdx => {
             if (data?.rounds?.length > (prev?.rounds?.length || 0)) {
                 return data.rounds.length - 1;
             } else if (data?.rounds?.length && data.rounds.length <= currentIdx) {
                 return Math.max(0, data.rounds.length - 1);
             }
             return currentIdx;
         });
         return data;
      });
      setLoading(false);
    } catch (err) {
      console.error(err);
      setError('An error occurred.');
      setLoading(false);
    }
  };

  const handleResultChange = async (pairingIndex, result) => {
    if (!session || !session.rounds) return;
    setSavingId(pairingIndex);

    const newRounds = [...session.rounds];
    const targetRound = { ...newRounds[selectedRoundIndex] };
    const newPairings = [...targetRound.pairings];
    
    newPairings[pairingIndex] = { ...newPairings[pairingIndex], result };
    targetRound.pairings = newPairings;
    newRounds[selectedRoundIndex] = targetRound;

    try {
      const res = await fetch(`/api/arbiter/session/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rounds: newRounds }),
      });

      if (!res.ok) throw new Error('Failed to save');
      
      setSession({ ...session, rounds: newRounds });
    } catch (err) {
      alert('Failed to save result. Please try again.');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-50-950 flex flex-col items-center justify-center p-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary-500 mb-4" />
        <p className="text-surface-600-400">Loading session...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-surface-50-950 flex flex-col items-center justify-center p-4">
        <AlertTriangle className="w-12 h-12 text-error-500 mb-4" />
        <h2 className="text-xl font-bold mb-2">Error</h2>
        <p className="text-surface-600-400 text-center">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-50-950 pb-20">
      <div className="sticky top-0 z-10 flex flex-col shadow-sm">
        <header className="bg-surface-100-900 p-4 flex items-center justify-between border-b border-surface-200-800">
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <Swords className="w-5 h-5 text-primary-500" />
              Remote Input
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-xs bg-success-500/10 text-success-700 dark:text-success-400 px-2 py-1 rounded-full flex items-center gap-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-success-500"></span>
              </span>
              Live
            </div>
            <Lightswitch />
          </div>
        </header>

        {session?.rounds?.length > 0 && (
          <div className="bg-surface-50-950 p-2 border-b border-surface-200-800 flex items-center justify-center gap-4">
            <button 
               onClick={() => setSelectedRoundIndex(Math.max(0, selectedRoundIndex - 1))}
               disabled={selectedRoundIndex === 0}
               className="p-1.5 rounded-lg hover:bg-surface-200-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
               <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="font-semibold text-sm w-20 text-center">
               Round {session.rounds[selectedRoundIndex]?.roundNumber}
            </span>
            <button 
               onClick={() => setSelectedRoundIndex(Math.min(session.rounds.length - 1, selectedRoundIndex + 1))}
               disabled={selectedRoundIndex === session.rounds.length - 1}
               className="p-1.5 rounded-lg hover:bg-surface-200-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
               <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      <main className="p-4 max-w-2xl mx-auto space-y-4">
        {!session?.rounds || session.rounds.length === 0 ? (
          <div className="py-24 text-center space-y-4 bg-surface-100-800 border border-dashed border-surface-200-700 rounded-2xl">
            <div className="w-16 h-16 bg-primary-500/10 rounded-full flex items-center justify-center mx-auto">
              <Swords className="text-primary-500" size={32} />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-bold">No Rounds Yet</h3>
              <p className="text-sm text-surface-600-400">Waiting for the tournament director to pair the first round...</p>
            </div>
          </div>
        ) : (
          session?.rounds?.[selectedRoundIndex]?.pairings?.map((pairing, index) => {
            if (pairing.isBye) {
              const playerName = pairing.whitePlayer?.name || pairing.whiteName || (pairing.whiteId ? `Player ${pairing.whiteId}` : 'Unknown Player');
              const hasExtraInfo = pairing.whitePlayer?.title || pairing.whitePlayer?.rating || pairing.whitePlayer?.federation || pairing.whitePlayer?.club;

              return (
                <div key={index} className="bg-surface-100-800 rounded-xl p-4 border border-surface-200-700 shadow-sm opacity-60">
                  <div className="flex justify-between items-center">
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm sm:text-base">{playerName}</span>
                      {hasExtraInfo ? (
                        <span className="text-xs text-surface-500-400 mt-0.5">
                          {pairing.whitePlayer?.title ? `${pairing.whitePlayer.title} ` : ''}
                          {pairing.whitePlayer?.rating ? `(${pairing.whitePlayer.rating}) ` : ''}
                          {pairing.whitePlayer?.federation || ''}
                          {pairing.whitePlayer?.club ? ` • ${pairing.whitePlayer.club}` : ''}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-sm bg-surface-200-700 px-2 py-1 rounded whitespace-nowrap ml-4">
                      {(() => {
                        const res = pairing.result || (pairing.isTournamentForfeit ? '0-0' : pairing.isSkip ? '0-0' : '1-0');
                        const pts = (res === '1-0' || res === '1-0f') ? '1' : res === '0.5-0.5' ? '½' : '0';
                        const label = pairing.isTournamentForfeit ? 'FORFEIT' : pairing.isSkip ? 'SKIP' : 'BYE';
                        return `${label} (${pts})`;
                      })()}
                    </div>
                  </div>
                </div>
              );
            }

            const result = pairing.result || '';
            
            return (
              <div key={index} className={`bg-surface-100-800 rounded-xl p-4 border shadow-sm transition-colors ${result ? 'border-primary-500/30' : 'border-surface-200-700'}`}>
                <div className="flex justify-between items-center text-sm font-medium mb-3 pb-3 border-b border-surface-200-700">
                  <span>Board {index + 1}</span>
                  {savingId === index ? (
                    <span className="text-xs flex items-center gap-1 text-surface-500"><Loader2 className="w-3 h-3 animate-spin"/> Saving</span>
                  ) : result ? (
                    <span className="text-xs flex items-center gap-1 text-success-500"><CheckCircle2 className="w-3 h-3"/> Saved</span>
                  ) : null}
                </div>
                
                <div className="flex flex-col gap-4 mb-4">
                  {/* White Player */}
                  <div className="flex justify-between items-center">
                      <div className="flex flex-col">
                          <span className="font-semibold text-sm sm:text-base">
                              {pairing.whitePlayer?.name || pairing.whiteName || `Player ${pairing.whiteId}`}
                          </span>
                          {(pairing.whitePlayer?.title || pairing.whitePlayer?.rating || pairing.whitePlayer?.federation || pairing.whitePlayer?.club) && (
                              <span className="text-xs text-surface-500-400 mt-0.5">
                                  {pairing.whitePlayer?.title ? `${pairing.whitePlayer.title} ` : ''}
                                  {pairing.whitePlayer?.rating ? `(${pairing.whitePlayer.rating}) ` : ''}
                                  {pairing.whitePlayer?.federation || ''}
                                  {pairing.whitePlayer?.club ? ` • ${pairing.whitePlayer.club}` : ''}
                              </span>
                          )}
                      </div>
                      <div className="w-4 h-4 rounded-sm border border-surface-300-600 bg-white shadow-sm shrink-0 ml-2" title="White Pieces"></div>
                  </div>

                  {/* Black Player */}
                  <div className="flex justify-between items-center">
                      <div className="flex flex-col">
                          <span className="font-semibold text-sm sm:text-base">
                              {pairing.blackPlayer?.name || pairing.blackName || `Player ${pairing.blackId}`}
                          </span>
                          {(pairing.blackPlayer?.title || pairing.blackPlayer?.rating || pairing.blackPlayer?.federation || pairing.blackPlayer?.club) && (
                              <span className="text-xs text-surface-500-400 mt-0.5">
                                  {pairing.blackPlayer?.title ? `${pairing.blackPlayer.title} ` : ''}
                                  {pairing.blackPlayer?.rating ? `(${pairing.blackPlayer.rating}) ` : ''}
                                  {pairing.blackPlayer?.federation || ''}
                                  {pairing.blackPlayer?.club ? ` • ${pairing.blackPlayer.club}` : ''}
                              </span>
                          )}
                      </div>
                      <div className="w-4 h-4 rounded-sm border border-surface-600-300 bg-black shadow-sm shrink-0 ml-2" title="Black Pieces"></div>
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-4 pt-4 border-t border-surface-200-700">
                  <span className="text-sm font-medium text-surface-600-400 whitespace-nowrap">Result:</span>
                  <select
                      value={result}
                      onChange={(e) => handleResultChange(index, e.target.value)}
                      disabled={savingId === index || selectedRoundIndex !== session.rounds.length - 1}
                      className="w-full bg-surface-50-950 border border-surface-300-700 rounded-lg p-2 text-sm font-medium appearance-none cursor-pointer focus:ring-2 focus:ring-primary-500 outline-none transition-colors"
                      style={{ backgroundImage: 'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right .5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
                  >
                      {RESULT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                  </select>
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
