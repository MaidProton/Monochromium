export interface PauseMenuPolicy {
  readonly pausesSimulationOnOpen: boolean;
  readonly autoPaused: boolean;
  readonly matchContinues: boolean;
  readonly resumeSimulationOnClose: boolean;
}

export const getPauseMenuPolicy = (multiplayer: boolean, currentlyPaused: boolean): PauseMenuPolicy => multiplayer
  ? {
      pausesSimulationOnOpen: false,
      autoPaused: false,
      matchContinues: !currentlyPaused,
      resumeSimulationOnClose: false,
    }
  : {
      pausesSimulationOnOpen: true,
      autoPaused: !currentlyPaused,
      matchContinues: false,
      resumeSimulationOnClose: true,
    };

export const captureDraftBaseline = (draft: unknown): string => JSON.stringify(draft);

export const hasDraftChanged = (draft: unknown, baseline: string): boolean =>
  Boolean(draft && baseline && JSON.stringify(draft) !== baseline);
