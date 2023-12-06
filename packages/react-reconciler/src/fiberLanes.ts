import {
  unstable_getCurrentPriorityLevel,
  unstable_ImmediatePriority,
  unstable_UserBlockingPriority,
  unstable_NormalPriority
} from 'scheduler';
export type Lane = number;
export type Lanes = number;

export const NoLane = 0b00000;
export const NoLanes = 0b00000;
export const SyncLane = 0b00001;
export const InputContinuousLane = 0b00010;
export const DefaultLane = 0b00100;
export const TransitionLane = 0b01000;
export const IdleLane = 0b10000;

export function mergeLanes(laneA: Lane, laneB: Lane): Lanes {
  return laneA | laneB;
}
export function schedulerPriorityToLane(schedulerPriority: number): Lane {
  switch (schedulerPriority) {
    case unstable_ImmediatePriority:
      return SyncLane;
    case unstable_UserBlockingPriority:
      return InputContinuousLane;
    case unstable_NormalPriority:
      return DefaultLane;
    default:
      return NoLane;
  }
}

export const requestUpdateLane = () => {
  const currentSchedulerPriority = unstable_getCurrentPriorityLevel();
  const lane = schedulerPriorityToLane(currentSchedulerPriority);
  return lane;
};
