export type Stage = 'idle' | 'number' | 'count' | 'only' | 'person' | 'champion' | 'pair' | 'pair_count' | 'pair_person' | 'final';

export type FinalPairPerson = {
  number: 1 | 2;
  count: number;
  participantId: number | null;
  participantName: string | null;
};

export interface AdvanceInput {
  status: 'closed' | 'presenting' | 'finished';
  min: number;
  max: number;
  current: number | null;
  stage: Stage;
  count: number;
  participantId: number | null;
  participantName: string | null;
  finalPair?: FinalPairPerson[];
  championId: number | null;
  championNumber: number | null;
  history: Array<{ number: number; participantId: number; name: string }>;
}

export interface AdvanceResult {
  gameStatus: 'presenting' | 'finished';
  current: number;
  stage: Stage;
  championId: number | null;
  championNumber: number | null;
  history: AdvanceInput['history'];
}

export function advancePresentation(input: AdvanceInput): AdvanceResult {
  if (input.status === 'finished') throw new Error('発表は終了しています。');
  if (input.status === 'closed') {
    if (input.min === 1 && input.max === 2) {
      return { gameStatus: 'presenting', current: 2, stage: 'pair', championId: null, championNumber: null, history: [] };
    }
    return { gameStatus: 'presenting', current: input.max, stage: 'number', championId: null, championNumber: null, history: [] };
  }
  if (input.current === null) throw new Error('発表状態が壊れています。');
  const current = input.current;

  const base = {
    gameStatus: 'presenting' as const,
    current,
    championId: input.championId,
    championNumber: input.championNumber,
    history: input.history,
  };
  const nextNumber = () => input.min === 1 && current === 3
    ? { ...base, current: 2, stage: 'pair' as const }
    : { ...base, current: current - 1, stage: 'number' as const };

  if (input.stage === 'number') return { ...base, stage: 'count' };
  if (input.stage === 'count' && input.count === 1) return { ...base, stage: 'only' };
  if (input.stage === 'only') return { ...base, stage: 'person' };
  if (input.stage === 'person') {
    if (!input.participantId || !input.participantName) throw new Error('回答者が見つかりません。');
    const history = [...input.history, { number: current, participantId: input.participantId, name: input.participantName }];
    return { ...base, stage: 'champion', championId: input.participantId, championNumber: current, history };
  }
  if (input.stage === 'champion') {
    return current === input.min
      ? { ...base, stage: 'final', gameStatus: 'finished' }
      : nextNumber();
  }
  if (input.stage === 'count' && input.count !== 1) {
    return current === input.min
      ? { ...base, stage: 'final', gameStatus: 'finished' }
      : nextNumber();
  }
  if (input.stage === 'pair') return { ...base, current: 2, stage: 'pair_count' };
  if (input.stage === 'pair_count') {
    const unique = (input.finalPair || []).filter((entry) => entry.count === 1);
    if (!unique.length) return { ...base, current: 2, stage: 'final', gameStatus: 'finished' };
    if (unique.some((entry) => !entry.participantId || !entry.participantName)) throw new Error('1または2の回答者が見つかりません。');
    const winner = [...unique].sort((a, b) => a.number - b.number)[0];
    const history = [...input.history, ...[...unique].sort((a, b) => b.number - a.number).map((entry) => ({
      number: entry.number,
      participantId: entry.participantId!,
      name: entry.participantName!,
    }))];
    return { ...base, current: 2, stage: 'pair_person', championId: winner.participantId, championNumber: winner.number, history };
  }
  if (input.stage === 'pair_person') return { ...base, current: 2, stage: 'final', gameStatus: 'finished' };
  throw new Error('この状態では次へ進めません。');
}
