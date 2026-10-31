import type { OutputDestinationState } from '@lingbo/shared';
import type { OutputEngine, ProgramOverlay, PushTarget, RunningPush } from './types';

export class MockOutput implements OutputEngine {
  readonly id = 'mock' as const;

  async start(input: { targets: PushTarget[] }): Promise<RunningPush> {
    return new MockPush(input.targets);
  }
}

class MockPush implements RunningPush {
  constructor(private readonly targets: PushTarget[]) {}

  async stop() {}

  setOverlay(_overlay: ProgramOverlay) {}

  async refresh() {}

  statuses(): OutputDestinationState[] {
    return this.targets.map((target) => ({
      destinationId: target.destinationId,
      status: 'simulated',
      reconnects: 0,
      detail: '',
    }));
  }
}
