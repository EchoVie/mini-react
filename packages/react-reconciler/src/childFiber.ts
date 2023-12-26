import {
  FiberNode,
  createWorkInProgress,
  createFiberFromElement,
  createFiberFromFragment
} from './fiber';
import { ChildDeletion, Placement } from './fiberFlags';
import { Props, ReactElementType, Key } from 'shared/ReactTypes';
import { Fragment, HostText } from './workTags';
import { REACT_FRAGMENT_TYPE, REACT_ELEMENT_TYPE } from 'shared/ReactSymbols';

type ExistingChildren = Map<string | number, FiberNode>;

export const cloneChildFibers = (wip: FiberNode) => {
  if (wip.child === null) {
    return;
  }

  let currentChild = wip.child;
  let newChild = createWorkInProgress(currentChild, currentChild.pendingProps);
  wip.child = newChild;
  newChild.return = wip;

  while (currentChild.sibling !== null) {
    currentChild = currentChild.sibling;
    newChild = newChild.sibling = createWorkInProgress(
      newChild,
      newChild.pendingProps
    );
    newChild.return = wip;
  }
};

function updateFragment(
  returnFiber: FiberNode,
  current: FiberNode | undefined, // existingChildren.get(element.key)或者element的index匹配到的fiber
  element: any[], // newFiber[index]
  key: Key,
  existingChildren: ExistingChildren
) {
  let fiber;
  if (!current || current.tag !== Fragment) {
    fiber = createFiberFromFragment(element, key);
  } else {
    existingChildren.delete(key);
    fiber = useFiber(current, element);
  }

  fiber.return = returnFiber;
  return fiber;
}

function ChildReconciler(
  shouldTrackSideEffects: boolean
) {
  // 1. mount的话直接返回
  // 2. update的话 加入returnFiber.deletions并returnFiber.flags上增加ChildDeletion
  function deleteChild(returnFiber: FiberNode, childToDelete: FiberNode) {
    if (!shouldTrackSideEffects) {
      return;
    }
    const deletions = returnFiber.deletions;

    if (deletions === null) {
      returnFiber.deletions = [childToDelete];
      returnFiber.flags |= ChildDeletion;
    } else {
      deletions.push(childToDelete);
    }
  }

  function deleteRemainingChildren(
    returnFiber: FiberNode,
    currentFirstChild: FiberNode | null
  ) {
    if (!shouldTrackSideEffects) {
      return null;
    }

    let childToDelete: FiberNode | null = currentFirstChild;

    while (childToDelete !== null) {
      deleteChild(returnFiber, childToDelete);
      childToDelete = childToDelete.sibling;
    }

    return null;
  }

  function mapRemainingChildren(
    currentFirstChild: FiberNode | null
  ): Map<string | number, FiberNode> {
    const existingChildren: ExistingChildren = new Map;

    let existingChild: FiberNode | null = currentFirstChild;
    while (existingChild !== null) {
      const key =
        existingChild.key === null ? existingChild.index : existingChild.key;
      existingChildren.set(key, existingChild);

      existingChild = existingChild.sibling;
    }

    return existingChildren;
  }

  function getElementKeyToUse(element: any, index?: number) {
    if (
      Array.isArray(element) ||
      typeof element === 'string' ||
      typeof element === 'number' ||
      element === undefined ||
      element === null
    ) {
      return index;
    }

    return element.key !== null ? element.key : index;
  }

  function updateFromMap(
    returnFiber: FiberNode,
    existingChildren: ExistingChildren,
    index: number,
    element: any
  ) {
    const keyToUse = getElementKeyToUse(element, index);
    const before = existingChildren.get(keyToUse);

    // HostText
    if (typeof element === 'string' || typeof element === 'number') {
      if (before) {
        if (before.tag === HostText) {
          existingChildren.delete(keyToUse);
          return useFiber(before, { content: element + '' });
        }
      }
      return new FiberNode(HostText, { content: element + '' }, null);
    }

    if (typeof element === 'object' && element !== null) {
      switch (element.$$typeof) {
        case REACT_ELEMENT_TYPE:
          if (element.type === REACT_FRAGMENT_TYPE) {
            // 复用或者创建type为REACT_ELEMENT_TYPE的fiber
            return updateFragment(
              returnFiber,
              before,
              element,
              keyToUse,
              existingChildren
            );
          }
          // type为其他类型
          if (before) {
            if (before.type === element.type) {
              existingChildren.delete(keyToUse);
              return useFiber(before, element.props);
            }
          }
          return createFiberFromElement(element);
      }
    }

    // Array类型
    if (Array.isArray(element)) {
      return updateFragment(
        returnFiber,
        before,
        element,
        keyToUse,
        existingChildren
      );
    }

    return null;
  }

  function placeSingleChild(fiber: FiberNode) {
    if (shouldTrackSideEffects && fiber.alternate === null) {
      fiber.flags |= Placement;
    }

    return fiber;
  }

  function reconcileSingleElement(
    returnFiber: FiberNode,
    currentFiber: FiberNode | null,
    element: ReactElementType
  ) {
    const key = element.key;

    while (currentFiber !== null) {
      if (currentFiber.key === key) {
        if (element.$$typeof === REACT_ELEMENT_TYPE) {
          if (currentFiber.type === element.type) {
            let props = element.props;
            if (element.type === REACT_FRAGMENT_TYPE) {
              // 如果是fragment的话,新Fiber的pendingProps为child[]
              props = element.props.children;
            }
            const existing = useFiber(currentFiber, props);
            existing.return = returnFiber;
            deleteRemainingChildren(returnFiber, currentFiber.sibling);
            return existing;
          }
          deleteRemainingChildren(returnFiber, currentFiber);
        } else {
          if (__DEV__) {
            console.warn('还未实现的react类型', element);
          }
        }
        deleteChild(returnFiber, currentFiber);
        currentFiber = currentFiber.sibling;
      }
    }

    let fiber;
    if (element.type === REACT_FRAGMENT_TYPE) {
      // 创建新Fiber type为REACT_FRAGMENT_TYPE, pendingProps为child[]
      fiber = createFiberFromFragment(element.props.children, key);
    } else {
      // 根据element.type获取新fiber.tag, 并返回新fiber
      fiber = createFiberFromElement(element);
    }
    fiber.return = returnFiber;
    return fiber;
  }

  function reconcileSingleTextNode(
    returnFiber: FiberNode,
    currentFiber: FiberNode | null,
    content: string | number
  ) {
    while (currentFiber !== null) {
      if (currentFiber.tag === HostText) {
        const existing = useFiber(currentFiber, { content });
        existing.return = returnFiber;
        deleteRemainingChildren(returnFiber, currentFiber.sibling);
        return existing;
      }
      deleteChild(returnFiber, currentFiber);
      currentFiber = currentFiber.sibling;
    }

    const fiber = new FiberNode(HostText, { content }, null);
    fiber.return = returnFiber;
    return fiber;
  }

  function reconcileChildrenArray(
    returnFiber: FiberNode,
    currentFirstChild: FiberNode | null,
    newChild: any
  ) {
    // 最后一个可复用fiber在current中的index
    let lastPlacedIndex = 0;
    // 创建的最后一个fiber
    let lastNewFiber: FiberNode | null = null;
    // 创建的第一个fiber
    let firstNewFiber: FiberNode | null = null;

    // 1. 将currentFiber保存在map中
    const existingChildren = mapRemainingChildren(currentFirstChild);

    for (let i = 0; i < newChild.length; i++) {
      // 2.遍历newChild，寻找是否可复用
      const after = newChild[i];
      const newFiber = updateFromMap(returnFiber, existingChildren, i, after);

      if (newFiber === null) {
        continue;
      }

      // 3. 标记移动还是插入
      newFiber.index = i;
      newFiber.return = returnFiber;

      if (lastNewFiber === null) {
        lastNewFiber = newFiber;
        firstNewFiber = newFiber;
      } else {
        lastNewFiber.sibling = newFiber;
        lastNewFiber = lastNewFiber.sibling;
      }

      if (!shouldTrackSideEffects) {
        continue;
      }

      const current = newFiber.alternate;
      if (current !== null) {
        const oldIndex = current.index;
        if (oldIndex < lastPlacedIndex) {
          // 标记挪位置
          newFiber.flags |= Placement;
          continue;
        } else {
          lastPlacedIndex = oldIndex;
        }
      } else {
        // 标记新增
        newFiber.flags != Placement;
      }
    }

    // 4. 将Map中剩下的标记为删除
    existingChildren.forEach((fiber) => {
      deleteChild(returnFiber, fiber);
    });

    return firstNewFiber;
  }

  return function reconcileChildFibers(
    returnFiber: FiberNode,
    currentFiber: FiberNode | null,
    newChild: any
  ) {
    // 判断是否是Fragment
    const isUnkeyedTopLevelFragment =
      typeof newChild === 'object' &&
      newChild !== null &&
      newChild.type === REACT_FRAGMENT_TYPE &&
      newChild.key === null;

    if (isUnkeyedTopLevelFragment) {
      newChild = newChild.props.children;
    }

    if (typeof newChild === 'object' && newChild !== null) {
      // 多节点 reconcile
      if (Array.isArray(newChild)) {
        return reconcileChildrenArray(returnFiber, currentFiber, newChild);
      }

      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE:
          // 要追踪副作用且是新节点的话，则新节点打标Placement
          return placeSingleChild(
            reconcileSingleElement(returnFiber, currentFiber, newChild)
          );

        default:
          if (__DEV__) {
            console.log('未实现的reconcile类型', newChild);
          }
      }
    }

    // 单节点 reconcile
    if (typeof newChild === 'string' || typeof newChild === 'number') {
      return placeSingleChild(
        reconcileSingleTextNode(returnFiber, currentFiber, newChild)
      );
    }

    if (currentFiber !== null) {
      // 兜底删除
      deleteRemainingChildren(returnFiber, currentFiber);
    }

    if (__DEV__) {
      console.warn('未实现的reconcile类型', newChild);
    }

    return null;
  };
}

function useFiber(fiber: FiberNode, pendingProps: Props): FiberNode {
  // fiber 为 workInprogress.alternate的child
  const clone = createWorkInProgress(fiber, pendingProps);
  clone.index = 0;
  clone.sibling = null;
  return clone;
}

export const reconcileChildFibers = ChildReconciler(true);
export const mountChildFibers = ChildReconciler(false);
