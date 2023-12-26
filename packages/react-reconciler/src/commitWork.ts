import {
  Instance,
  Container,
  appendChildToContainer,
  insertChildToContainer,
  removeChild,
  commitUpdate,
  hideTextInstance,
  unhideTextInstance,
  hideInstance,
  unhideInstance
} from 'hostConfig';
import { FiberNode, FiberRootNode, PendingPassiveEffects } from './fiber';
import {
  ChildDeletion,
  Flags,
  LayoutMask,
  NoFlags,
  PassiveEffect,
  Placement,
  Visibility,
  Ref,
  Update,
  MutationMask,
  PassiveMask
} from './fiberFlags';
import { Effect } from './fiberHooks';
import { HookHasEffect } from './hookEffectTags';
import {
  OffscreenComponent,
  HostComponent,
  HostRoot,
  HostText,
  FunctionComponent
} from './workTags';
import { FCUpdateQueue } from './fiberHooks';

export function commitHookEffectListUnmount(flags: Flags, lastEffect: Effect) {
  commitHookEffectList(flags, lastEffect, (effect) => {
    const destroy = effect.destroy;
    if (typeof destroy === 'function') {
      destroy();
    }

    effect.tag &= ~HookHasEffect;
  });
}

export function commitHookEffectListDestroy(flags: Flags, lastEffect: Effect) {
  commitHookEffectList(flags, lastEffect, (effect) => {
    const destroy = effect.destroy;
    if (typeof destroy === 'function') {
      destroy();
    }
  });
}

export function commitHookEffectListCreate(flags: Flags, lastEffect: Effect) {
  commitHookEffectList(flags, lastEffect, (effect: Effect) => {
    const create = effect.create;
    if (typeof create === 'function') {
      effect.destroy = create();
    }
  });
}

function commitHookEffectList(
  flags: Flags,
  lastEffect: Effect,
  callback: (effect: Effect) => void
) {
  let effect = lastEffect.next as Effect;

  do {
    if ((effect.tag & flags) === flags) {
      callback(effect);
    }
    effect = effect.next as Effect;
  } while (effect !== lastEffect.next);
}

export const commitMutationEffects = commitEffects(
  'mutation',
  MutationMask | PassiveMask,
  commitMutationEffectsOnFiber
);

export const commitLayoutEffects = commitEffects(
  'layout',
  LayoutMask,
  commitLayoutEffectsOnFiber
);

let nextEffect: FiberNode | null = null;

function commitMutationEffectsOnFiber(
  finishedWork: FiberNode,
  root: FiberRootNode
) {
  const { flags, tag } = finishedWork;

  if ((flags & Placement) !== NoFlags) {
    commitPlacement(finishedWork);
    finishedWork.flags &= ~Placement;
  }
  if ((flags & Update) !== NoFlags) {
    commitUpdate(finishedWork);
    finishedWork.flags &= ~Update;
  }
  if ((flags & ChildDeletion) !== NoFlags) {
    const deletions = finishedWork.deletions;
    if (deletions !== null) {
      deletions.forEach((childToDeletion) => {
        commitDeletion(childToDeletion, root);
      });
    }
    finishedWork.flags &= ~ChildDeletion;
  }

  if ((flags & PassiveEffect) !== NoFlags) {
    commitPassiveEffect(finishedWork, root, 'update');
    finishedWork.flags &= ~PassiveEffect;
  }

  if ((flags & Ref) !== NoFlags && tag === HostComponent) {
    safelyDetachRef(finishedWork);
  }

  if ((flags & Visibility) !== NoFlags && tag === OffscreenComponent) {
    const isHidden = finishedWork.pendingProps.mode === 'hidden';
    hideOrUnhideAllChildren(finishedWork, isHidden);
    finishedWork.flags &= ~Visibility;
  }
}

// 找出有副作用的fibers
function commitEffects(
  phase: 'mutation' | 'layout',
  mask: Flags,
  callback: (fiber: FiberNode, root: FiberRootNode) => void
) {
  return (finishedWork: FiberNode, root: FiberRootNode) => {
    nextEffect = finishedWork;

    while (nextEffect !== null) {
      // 向下遍历
      const child: FiberNode | null = nextEffect.child;

      if ((nextEffect.subtreeFlags & mask) !== NoFlags && child !== null) {
        nextEffect = child;
      } else {
        up: while (nextEffect !== null) {
          // 向上遍历 DFS
          callback(nextEffect, root);
          const sibling: FiberNode | null = nextEffect.sibling;

          if (sibling !== null) {
            nextEffect = sibling;
            break up;
          }
          // 往上
          nextEffect = nextEffect.return;
        }
      }
    }
  };
}

// TODO：调用 useLayoutEffects
function commitLayoutEffectsOnFiber(finishedWork: FiberNode) {
  const { flags, tag } = finishedWork;

  if ((flags & Ref) !== NoFlags && tag === HostComponent) {
    safelyAttachRef(finishedWork);
    finishedWork.flags &= ~Ref;
  }
}

// 更新ref
function safelyAttachRef(fiber: FiberNode) {
  const ref = fiber.ref;
  if (ref !== null) {
    const instance = fiber.stateNode;
    if (typeof ref === 'function') {
      ref(instance);
    } else {
      ref.current = instance;
    }
  }
}

// 摘除元素身上的ref属性
function safelyDetachRef(current: FiberNode) {
  const ref = current.ref;
  if (ref !== null) {
    if (typeof ref === 'function') {
      ref(null);
    } else {
      ref.current = null;
    }
  }
}

function commitPlacement(finishedWork: FiberNode) {
  if (__DEV__) {
    console.warn('执行Placement操作', finishedWork);
  }
  const hostParent = getHostParent(finishedWork);
  const sibling = getHostSibling(finishedWork);
  if (hostParent !== null) {
    insertOrAppendPlacementNodeIntoContainer(finishedWork, hostParent, sibling);
  }
}

// 删除child及其子孙child
function commitDeletion(childToDelete: FiberNode, root: FiberRootNode) {
  const rootChildrenToDelete: FiberNode[] = [];

  commitNestedComponent(childToDelete, (unmountFiber) => {
    switch (unmountFiber.tag) {
      case HostComponent: {
        // 将unmountFiber加入rootChildrenToDelete
        recordHostChildrenToDelete(rootChildrenToDelete, unmountFiber);
        // 摘除ref属性
        safelyDetachRef(unmountFiber);
        return;
      }

      case HostText:
        recordHostChildrenToDelete(rootChildrenToDelete, unmountFiber);
        return;

      case FunctionComponent:
        commitPassiveEffect(unmountFiber, root, 'unmount');
        return;

      default:
        if (__DEV__) {
          console.warn('未处理的unmount类型', unmountFiber);
        }
    }
  });

  if (rootChildrenToDelete.length) {
    const hostParent = getHostParent(childToDelete);
    if (hostParent !== null) {
      rootChildrenToDelete.forEach((node) => {
        removeChild(node.stateNode, hostParent);
      });
    }
  }
  childToDelete.return = null;
  childToDelete.child = null;
}

// FiberRootNode.pendingPassiveEffects 上增加 当前fiber.updateQueue.lastEffect
function commitPassiveEffect(
  fiber: FiberNode,
  root: FiberRootNode,
  type: keyof PendingPassiveEffects
) {
  if (
    fiber.tag !== FunctionComponent ||
    (type === 'update' && (fiber.flags & PassiveEffect) === NoFlags)
  ) {
    return;
  }

  const updateQueue = fiber.updateQueue as FCUpdateQueue<any>;
  if (updateQueue !== null) {
    if (updateQueue.lastEffect === null && __DEV__) {
      console.error('当FC存在PassiveEffect flag时， 不应该不存在effect');
    }
    root.pendingPassiveEffects[type].push(updateQueue.lastEffect as Effect);
  }
}

function hideOrUnhideAllChildren(finishedWork: FiberNode, isHidden: boolean) {
  findHostSubtreeRoot(finishedWork, (hostRoot: FiberNode) => {
    const instance = hostRoot.stateNode;
    if (hostRoot.tag === HostComponent) {
      isHidden ? hideInstance(instance) : unhideInstance(instance);
    } else if (hostRoot.tag === HostText) {
      isHidden
        ? hideTextInstance(instance)
        : unhideTextInstance(instance, hostRoot.memoizedState.content);
    }
  });
}

function insertOrAppendPlacementNodeIntoContainer(
  finishedWork: FiberNode,
  hostParent: Container,
  before?: Instance
) {
  if (finishedWork.tag === HostComponent || finishedWork.tag === HostText) {
    if (before) {
      insertChildToContainer(finishedWork.stateNode, hostParent, before);
    } else {
      appendChildToContainer(hostParent, finishedWork.stateNode);
    }

    return;
  }
  const child = finishedWork.child;
  if (child !== null) {
    insertOrAppendPlacementNodeIntoContainer(child, hostParent);
    let sibling = child.sibling;

    while (sibling !== null) {
      insertOrAppendPlacementNodeIntoContainer(sibling, hostParent);
      sibling = sibling.sibling;
    }
  }
}

function getHostParent(finishedWork: FiberNode): Container | null {
  let parent = finishedWork.return;
  while (parent !== null) {
    if (parent.tag === HostComponent) {
      return parent.stateNode as Container;
    }

    if (parent.tag === HostRoot) {
      return (parent.stateNode as FiberRootNode).container;
    }

    parent = parent.return;
  }

  if (__DEV__) {
    console.warn('未找到host parent');
  }

  return null;
}

function getHostSibling(fiber: FiberNode) {
  let node: FiberNode = fiber;

  findSibling: while (true) {
    // 没有sibling 往上找
    while (node.sibling === null) {
      const parent = node.return;

      if (
        parent === null ||
        parent.tag === HostComponent ||
        parent.tag === HostRoot
      ) {
        return null;
      }
      node = parent;
    }

    // 有sibling 往右找
    node.sibling.return = node.return;
    node = node.sibling;

    // 往下找
    while (node.tag !== HostText && node.tag !== HostComponent) {
      if ((node.flags & Placement) !== NoFlags) {
        // 不稳定的元素
        continue findSibling; // 重新往上往右找
      }
      if (node.child === null) {
        continue findSibling; // 重新往上往右找
      } else {
        node.child.return = node;
        node = node.child;
      }
    }

    // 找到了
    if ((node.flags & Placement) === NoFlags) {
      return node.stateNode;
    }
  }
}

// 找到当前和sibling的所有child 执行 onCommitUnmount
function commitNestedComponent(
  fiber: FiberNode,
  onCommitUnmount: (fiber: FiberNode) => void
) {
  let node = fiber;

  while (true) {
    onCommitUnmount(node);

    if (node.child !== null) {
      node.child.return = node;
      node = node.child;
      continue;
    }

    if (node === fiber) {
      return;
    }

    while (node.sibling === null) {
      if (node.return === null || node.return === fiber) {
        return;
      }
    }

    node.sibling.return = node.return;
    node = node.sibling;
  }
}

function recordHostChildrenToDelete(
  childrenToDelete: FiberNode[],
  unmountFiber: FiberNode
) {
  const lastOne = childrenToDelete[childrenToDelete.length - 1];

  // 1. childrenToDelete没数据，则直接新增unmountFiber
  if (!lastOne) {
    childrenToDelete.push(unmountFiber);
  } else {
    // childrenToDelete有数据，遍历childrenToDelete存储的最后一个fiber的sibling是否有一个是unmountFiber，有则加入数组
    let node = lastOne.sibling;

    while (node !== null) {
      if (unmountFiber === node) {
        childrenToDelete.push(unmountFiber);
      }
      node = node.sibling;
    }
  }
}

function findHostSubtreeRoot(
  finishedWork: FiberNode,
  callback: (hostSubtreeRoot: FiberNode) => void
) {
  let hostSubtreeRoot = null;
  let node = finishedWork;

  while (true) {
    if (node.tag === HostComponent) {
      if (hostSubtreeRoot === null) {
        // 还未发现 root，当前就是
        hostSubtreeRoot = node;
        callback(node);
      }
    } else if (node.tag === HostText) {
      if (hostSubtreeRoot === null) {
        // 还未发现 root，text可以是顶层节点
        callback(node);
      }
    } else if (
      node.tag === OffscreenComponent &&
      node.pendingProps.mode === 'hidden' &&
      node !== finishedWork
    ) {
      // 隐藏的OffscreenComponent跳过
    } else if (node.child !== null) {
      node.child.return = node;
      node = node.child;
      continue;
    }

    if (node === finishedWork) {
      return;
    }

    while (node.sibling === null) {
      if (node.return === null || node.return === finishedWork) {
        return;
      }

      if (hostSubtreeRoot === node) {
        hostSubtreeRoot = null;
      }
      node = node.return;
    }

    // 去兄弟节点寻找，此时当前子树的host root可以移除了
    if (hostSubtreeRoot === node) {
      hostSubtreeRoot = null;
    }

    node.sibling.return = node.sibling;
    node = node.sibling;
  }
}
