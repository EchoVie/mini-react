import {
  Props,
  Key,
  Ref,
  Wakeable,
  ReactElementType,
  ReactFragment
} from 'shared/ReactTypes';
import {
  REACT_SUSPENSE_TYPE,
  REACT_PROVIDER_TYPE,
  REACT_MEMO_TYPE,
  REACT_LAZY_TYPE
} from 'shared/ReactSymbols';
import {
  ContextProvider,
  FunctionComponent,
  HostComponent,
  LazyComponent,
  MemoComponent,
  WorkTag,
  SuspenseComponent,
  OffscreenComponent
} from './workTags';
import { Flags, NoFlags } from './fiberFlags';
import { ContextItem } from './fiberContext';
import { Effect } from './fiberHooks';
import { Lanes, Lane, NoLane, NoLanes } from './fiberLanes';
import { Container } from 'hostConfig';
import { CallbackNode } from 'scheduler';
import { Fragment } from 'react';

interface FiberDependencies<Value> {
  firstContext: ContextItem<Value> | null;
  lanes: Lanes;
}

export interface OffscreenProps {
  mode: 'visible' | 'hidden';
  children: any;
}

export class FiberNode {
  type: any;
  tag: WorkTag;
  key: Key;
  ref: Ref | null;
  stateNode: any;

  return: FiberNode | null;
  sibling: FiberNode | null;
  child: FiberNode | null;
  index: number;

  pendingProps: Props;
  memoizedProps: Props | null;
  memoizedState: any;
  updateQueue: unknown;
  alternate: FiberNode | null;
  flags: Flags;
  subtreeFlags: Flags;
  deletions: FiberNode[] | null;

  lanes: Lanes;
  childLanes: Lanes;

  dependencies: FiberDependencies<any> | null;

  constructor(tag: WorkTag, pendingProps: Props, key: Key) {
    // 实例
    this.tag = tag;
    this.key = key || null;
    // HostComponent <div> div DOM
    this.stateNode = null;
    // FunctionComponent () => {}
    this.type = null;

    // 构成树状结构
    this.return = null;
    this.sibling = null;
    this.child = null;
    this.index = 0;

    this.ref = null;

    // 作为工作单元
    this.pendingProps = pendingProps;
    this.memoizedProps = null;
    this.memoizedState = null;
    this.updateQueue = null;

    this.alternate = null;
    // 副作用
    this.flags = NoFlags;
    this.subtreeFlags = NoFlags;
    this.deletions = null;

    this.lanes = NoLanes;
    this.childLanes = NoLanes;

    this.dependencies = null;
  }
}

export interface PendingPassiveEffects {
  unmount: Effect[];
  update: Effect[];
}

export class FiberRootNode {
  container: Container;
  current: FiberNode;
  finishedWork: FiberNode | null;
  pendingLanes: Lanes;
  suspendedLanes: Lanes;
  pingedLanes: Lanes;
  finishedLane: Lanes;
  pendingPassiveEffects: PendingPassiveEffects;

  callbackNode: CallbackNode | null;
  callbackPriority: Lane;

  pingCache: WeakMap<Wakeable<any>, Set<Lane>> | null;

  constructor(container: Container, hostRootFiber: FiberNode) {
    this.container = container;
    this.current = hostRootFiber;
    hostRootFiber.stateNode = this;
    this.finishedWork = null;
    this.pendingLanes = NoLane;
    this.suspendedLanes = NoLane;
    this.pingedLanes = NoLane;
    this.finishedLane = NoLane;

    this.callbackNode = null;
    this.callbackPriority = NoLane;

    this.pendingPassiveEffects = {
      unmount: [],
      update: []
    };

    this.pingCache = null;
  }
}

export const createWorkInProgress = (
  current: FiberNode,
  pendingProps: Props
) => {
  let wip = current.alternate;
  if (wip === null) {
    wip = new FiberNode(current.tag, pendingProps, current.key);
    wip.stateNode = current.stateNode;

    wip.alternate = current;
    current.alternate = wip;
  } else {
    wip.pendingProps = pendingProps;
    wip.flags = NoFlags;
    wip.subtreeFlags = NoFlags;
    wip.deletions = null;
  }

  wip.type = current.type;
  wip.updateQueue = current.updateQueue;
  wip.child = current.child;
  wip.memoizedProps = current.memoizedProps;
  wip.memoizedState = current.memoizedState;
  wip.ref = current.ref;

  wip.lanes = current.lanes;
  wip.childLanes = current.childLanes;

  const currentDeps = current.dependencies;

  wip.dependencies =
    currentDeps === null
      ? null
      : {
          lanes: currentDeps.lanes,
          firstContext: currentDeps.firstContext
        };

  return wip;
};

export function createFiberFromElement(element: ReactElementType) {
  const { type, key, props, ref } = element;
  let fiberTag: WorkTag = FunctionComponent;

  if (typeof type === 'string') {
    fiberTag = HostComponent;
  } else if (typeof type === 'object') {
    switch (type.$$typeof) {
      case REACT_PROVIDER_TYPE:
        fiberTag = ContextProvider;
        break;

      case REACT_MEMO_TYPE:
        fiberTag = MemoComponent;
        break;

      case REACT_LAZY_TYPE:
        fiberTag = LazyComponent;
        break;

      default:
        console.warn('未定义的type类型', element);
    }
  } else if (type === REACT_SUSPENSE_TYPE) {
    fiberTag = SuspenseComponent;
  } else if (typeof type !== 'function' && __DEV__) {
    console.warn('未定义的type类型', element);
  }

  const fiber = new FiberNode(fiberTag, props, key);
  fiber.type = type;
  fiber.ref = ref;
  return fiber;
}

export function createFiberFromFragment(elements: ReactFragment, key: Key) {
  // elements为fiber的children
  const fiber = new FiberNode(Fragment, elements, key);
  return fiber;
}

export function createFiberFromOffscreen(pendingProps: OffscreenProps) {
  const fiber = new FiberNode(OffscreenComponent, pendingProps, null);
  return fiber;
}
