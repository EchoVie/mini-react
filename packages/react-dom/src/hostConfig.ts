import { FiberNode } from 'react-reconciler/src/fiber';
import { Props } from 'shared/ReactTypes';
import { updateFiberProps } from './SyntheticEvent';
import { HostComponent, HostText } from 'react-reconciler/src/workTags';

export type Container = Element;
export type Instance = Element;
export type TextInstance = Text;

export const createInstance = (type: string, props: Props) => {
  const element = document.createElement(type);

  return element;
};

export const createTextInstance = (content: string) => {
  return document.createTextNode(content);
};

export const appendInitialChild = (
  parent: Container | Instance,
  child: Instance
) => {
  parent.appendChild(child);
};

export const appendChildToContainer = appendInitialChild;

export const insertChildToContainer = (
  child: Instance,
  container: Container,
  before: Instance
) => {
  container.insertBefore(before, child);
};

export const commitUpdate = (fiber: FiberNode) => {
  switch (fiber.tag) {
    case HostText: {
      const text = fiber.memoizedProps.content;
      return commitTextUpdate(fiber.stateNode, text);
    }

    case HostComponent:
      return updateFiberProps(fiber.stateNode, fiber.memoizedProps);
  }
};

export function commitTextUpdate(textInstance: TextInstance, content: string) {
  textInstance.textContent = content;
}
