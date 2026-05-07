/**
 * Standings Calculation Logic
 * 
 * This module provides functions to calculate tournament standings
 * and various tiebreaker systems.
 */

export function calculateStandings(players, rounds, tiebreakerPriority = ['bh', 'sb', 'wins']) {
    if (!players || players.length === 0) return [];

    const playerMap = players.reduce((acc, p) => {
        acc[p.playerUniqueId] = {
            ...p,
            points: 0,
            opponents: [], // Array of opponent IDs
            results: [], // Array of { opponentId, result, pointsEarned }
            tiebreakers: {
                bh: 0,
                bh_cut1: 0,
                sb: 0,
                wins: 0,
                direct: 0,
                progressive: 0,
                wins_black: 0,
                games_black: 0
            },
            cumulativeScores: [],
            unplayedRounds: 0,
            unplayedPoints: 0,
            tiebreakContributions: [] // List of scores of opponents (real or virtual)
        };
        return acc;
    }, {});

    // 1. Calculate base points and collect opponent data
    rounds.forEach((round) => {
        round.pairings.forEach((pairing) => {
            const { whiteId, blackId, result, isBye } = pairing;

            if (isBye) {
                if (playerMap[whiteId]) {
                    playerMap[whiteId].points += 1;
                    playerMap[whiteId].results.push({ opponentId: null, result: '1-0', pointsEarned: 1, isBye: true });
                    playerMap[whiteId].unplayedRounds += 1;
                    playerMap[whiteId].unplayedPoints += 1;
                }
            } else if (result) {
                const wPoints = (result === '1-0' || result === '1-0f') ? 1 : (result === '0.5-0.5' ? 0.5 : 0);
                const bPoints = (result === '0-1' || result === '0-1f') ? 1 : (result === '0.5-0.5' ? 0.5 : 0);
                const isForfeit = result.endsWith('f');

                if (playerMap[whiteId]) {
                    playerMap[whiteId].points += wPoints;
                    playerMap[whiteId].opponents.push(blackId);
                    playerMap[whiteId].results.push({ 
                        opponentId: blackId, 
                        result: result, 
                        pointsEarned: wPoints,
                        isForfeit: isForfeit
                    });
                    if (wPoints === 1 && !isForfeit) playerMap[whiteId].tiebreakers.wins += 1;
                    if (isForfeit) {
                        playerMap[whiteId].unplayedRounds += 1;
                        playerMap[whiteId].unplayedPoints += wPoints;
                    }
                }
                if (playerMap[blackId]) {
                    playerMap[blackId].points += bPoints;
                    playerMap[blackId].opponents.push(whiteId);
                    playerMap[blackId].tiebreakers.games_black += 1;
                    playerMap[blackId].results.push({ 
                        opponentId: whiteId, 
                        result: result, 
                        pointsEarned: bPoints,
                        isForfeit: isForfeit
                    });
                    if (bPoints === 1 && !isForfeit) {
                        playerMap[blackId].tiebreakers.wins += 1;
                        playerMap[blackId].tiebreakers.wins_black += 1;
                    }
                    if (isForfeit) {
                        playerMap[blackId].unplayedRounds += 1;
                        playerMap[blackId].unplayedPoints += bPoints;
                    }
                }
            }
        });

        // Track cumulative scores for progressive tiebreaker (AFTER each round)
        Object.values(playerMap).forEach(p => {
            p.cumulativeScores.push(p.points);
        });
    });

    // 2. Calculate "Tie-break Score" (Adjusted Score) for every player
    // This is the score used when this player is an opponent in someone else's tiebreak.
    // FIDE rule: Each unplayed round counts as 0.5 points.
    Object.values(playerMap).forEach(p => {
        p.tieBreakScore = p.points - p.unplayedPoints + (p.unplayedRounds * 0.5);
    });

    // 3. Calculate Tiebreakers
    Object.values(playerMap).forEach((p) => {
        const contributions = []; // List of scores contributing to BH

        p.results.forEach(res => {
            if (res.isBye) {
                // Bye: Draw against himself
                contributions.push(p.points);
                p.tiebreakers.sb += (0.5 * p.points);
            } else if (res.isForfeit) {
                // Forfeit: Virtual opponent depends on if it was a win or loss
                // Standard simplification: treat as draw against himself OR scheduled opponent's adjusted score
                // FIDE says for forfeit win: scheduled opponent's adjusted score.
                // For forfeit loss: draw against himself.
                const opponent = playerMap[res.opponentId];
                if (res.pointsEarned === 1) {
                    // Forfeit Win: use opponent's adjusted score
                    const score = opponent ? opponent.tieBreakScore : p.points;
                    contributions.push(score);
                    p.tiebreakers.sb += score; // win * score
                } else {
                    // Forfeit Loss: draw against himself
                    contributions.push(p.points);
                    // SB for loss is 0 * opponent score, but FIDE says unplayed games are draws.
                    // So it's 0.5 * player.points
                    p.tiebreakers.sb += (0.5 * p.points);
                }
            } else {
                // Regular game
                const opponent = playerMap[res.opponentId];
                const score = opponent ? opponent.tieBreakScore : 0;
                contributions.push(score);
                p.tiebreakers.sb += (res.pointsEarned * score);
            }
        });

        // Buchholz (BH)
        p.tiebreakers.bh = contributions.reduce((sum, s) => sum + s, 0);

        // Buchholz Cut 1 (BH-C1)
        if (contributions.length > 0) {
            const minScore = Math.min(...contributions);
            p.tiebreakers.bh_cut1 = p.tiebreakers.bh - minScore;
        } else {
            p.tiebreakers.bh_cut1 = 0;
        }

        // Progressive
        p.tiebreakers.progressive = p.cumulativeScores.reduce((sum, s) => sum + s, 0);
    });

    // 3. Final Ranking Sort
    const standings = Object.values(playerMap).sort((a, b) => {
        // Primary: Points
        if (b.points !== a.points) return b.points - a.points;

        // Tiebreakers in order of priority
        for (const tb of tiebreakerPriority) {
            if (tb === 'direct') {
                // Direct encounter between tied players
                const matchA = a.results.find(r => r.opponentId === b.playerUniqueId);
                const matchB = b.results.find(r => r.opponentId === a.playerUniqueId);
                
                if (matchA && matchB) {
                    if (matchB.pointsEarned !== matchA.pointsEarned) {
                        return matchB.pointsEarned - matchA.pointsEarned;
                    }
                }
                continue;
            }

            const valA = a.tiebreakers[tb] || 0;
            const valB = b.tiebreakers[tb] || 0;
            if (valB !== valA) return valB - valA;
        }

        // Final fallback: Rating, then Name
        if (b.rating !== a.rating) return (Number(b.rating) || 0) - (Number(a.rating) || 0);
        return a.name.localeCompare(b.name);
    });

    return standings;
}
