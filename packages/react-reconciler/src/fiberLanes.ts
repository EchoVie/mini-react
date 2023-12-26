import {
  unstable_getCurrentPriorityLevel,
  unstable_ImmediatePriority,
  unstable_UserBlockingPriority,
  unstable_NormalPriority,
  unstable_IdlePriority
} from 'scheduler';
import { FiberRootNode } from './fiber';
import ReactCurrentBatchConfig from 'react/src/currentBatchConfig';
export type Lane = number;
export type Lanes = number;

export const NoLane = 0b00000;
export const NoLanes = 0b00000;
export const SyncLane = 0b00001;
export const InputContinuousLane = 0b00010;
export const DefaultLane = 0b00100;
export const TransitionLane = 0b01000;
export const IdleLane = 0b10000;

export function removeLanes(set: Lanes, subset: Lanes | Lane): Lanes {
  return set & ~subset;
}
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

export function lanesToSchedulerPriority(lanes: Lanes) {
  const lane = getHighestPriorityLane(lanes);

  switch (lane) {
    case SyncLane:
      return unstable_ImmediatePriority;
    case InputContinuousLane:
      return unstable_UserBlockingPriority;
    case DefaultLane:
      return unstable_NormalPriority;
    default:
      return unstable_IdlePriority;
  }
}

export const requestUpdateLane = () => {
  // useTransition 中的update优先级会降到最低
  const istransition = ReactCurrentBatchConfig.transition !== null;

  if (istransition) {
    return TransitionLane;
  }

  const currentSchedulerPriority = unstable_getCurrentPriorityLevel();
  const lane = schedulerPriorityToLane(currentSchedulerPriority);
  return lane;
};

export function getNextLane(root: FiberRootNode) {
  const pendingLanes = root.pendingLanes;

  if (pendingLanes === NoLanes) {
    return NoLanes;
  }

  let nextLane = NoLane;

  // 清除掉挂起的lane
  // suspendedLanes = pendingLanes 减去 suspendedLanes
  const suspendedLanes = pendingLanes & ~root.suspendedLanes;
  if (suspendedLanes !== NoLanes) {
    nextLane = getHighestPriorityLane(suspendedLanes);
  } else {
    // 如果 pendingLanes 中包含pingedLanes则返回pingedLanes，否则返回 0
    const pingedLanes = pendingLanes & root.pingedLanes;

    if (pingedLanes !== NoLanes) {
      nextLane = getHighestPriorityLane(pingedLanes);
    }
  }

  return nextLane;
}

export function getHighestPriorityLane(lanes: Lanes) {
  return lanes & -lanes;
}

export function markRootSuspended(root: FiberRootNode, suspendedLane: Lane) {
  root.suspendedLanes |= suspendedLane; // 新增
  root.pingedLanes &= ~suspendedLane; // 去掉
}

export function includeSomeLanes(set: Lanes, subset: Lane | Lanes) {
  return (set & subset) !== NoLanes;
}

export function isSubsetOfLanes(set: Lanes, subset: Lane) {
  return (set & subset) === subset;
}

export function markRootFinished(root: FiberRootNode, lane: Lane) {
  root.pendingLanes &= ~lane;
  root.suspendedLanes = NoLane;
  root.pingedLanes = NoLane;
}

// root.suspendedLanes 包含 pingedLane的话，则在root.pingedLanes新增
export function markRootPinged(root: FiberRootNode, pingedLane: Lane) {
  root.pingedLanes |= root.suspendedLanes & pingedLane;
}
