import type { OutputDestinationState, OutputProviderId } from '@lingbo/shared';

export interface ProgramOverlay {
  hostName: string;
  caption: string;
  productTitle: string;
  priceLabel: string;
}

export interface PushTarget {
  destinationId: string;
  url: string;
  secret: string;
}

export interface RunningPush {
  stop(): Promise<void>;
  statuses(): OutputDestinationState[];
  setOverlay(overlay: ProgramOverlay): void;
  refresh(): Promise<void>;
}

export interface OutputEngine {
  readonly id: OutputProviderId;
  start(input: {
    sessionId: string;
    roomName: string;
    programUrl: string;
    targets: PushTarget[];
    overlay: ProgramOverlay;
  }): Promise<RunningPush>;
}

export const EMPTY_OVERLAY: ProgramOverlay = {
  hostName: '',
  caption: '',
  productTitle: '',
  priceLabel: '',
};
