import { ShouldCapture } from './fiberFlags';
import { getSuspenseHandler } from './suspenseContext';
import { FiberRootNode } from './fiber';
import { Lane, markRootPinged } from './fiberLanes';
import { Wakeable } from 'shared/ReactTypes';
import { ensureRootIsScheduled, markRootUpdated } from './workLoop';

function attachPingListener(
  root: FiberRootNode,
  wakeable: Wakeable<any>,
  lane: Lane
) {
  let pingCache = root.pingCache;
  let threadIDs: Set<Lane> | undefined;

  // 以wakeable为key在pingCache这个map上取值，没有的话则创建
  if (pingCache === null) {
    threadIDs = new Set<Lane>();
    pingCache = root.pingCache = new WeakMap<Wakeable<any>, Set<Lane>>();
  } else {
    threadIDs = pingCache.get(wakeable);
    if (threadIDs === undefined) {
      threadIDs = new Set<Lane>();
      pingCache.set(wakeable, threadIDs);
    }
  }

  if (!threadIDs.has(lane)) {
    threadIDs.add(lane);

    const ping = () => {
      if (pingCache !== null) {
        pingCache.delete(wakeable);
      }
      markRootUpdated(root, lane);
      markRootPinged(root, lane);
      ensureRootIsScheduled(root);
    };
    wakeable.then(ping, ping);
  }
}

export function throwException(root: FiberRootNode, value: any, lane: Lane) {
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof value.then === 'function'
  ) {
    const weakable: Wakeable<any> = value;

    const suspenseBoundary = getSuspenseHandler();

    if (suspenseBoundary) {
      suspenseBoundary.flags |= ShouldCapture;
    }
    // 根据 lane 调度更新
    attachPingListener(root, weakable, lane);
  }
}
