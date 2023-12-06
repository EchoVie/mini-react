import { ElementType, Ref, Key, Props } from 'shared/ReactTypes';
import { REACT_ELEMENT_TYPE } from 'shared/ReactSymbols';

const ReactElement = (type: ElementType, key: Key, ref: Ref, props: Props) => {
  return {
    $$typeof: REACT_ELEMENT_TYPE,
    type,
    ref,
    key,
    props
  };
};

export const jsx = (type: ElementType, config: any, ...maybeChildren: any) => {
  let key: any = null;
  let ref: Ref = null;
  const props: Props = {};

  for (const prop in config) {
    const val = config[prop];
    if (prop === 'key') {
      if (val !== undefined) {
        key = '' + val;
      }
      continue;
    }

    if (prop === 'ref') {
      if (val !== undefined) {
        ref = val;
      }
      continue;
    }

    if ({}.hasOwnProperty.call(config, prop)) {
      props[prop] = val;
    }
  }

  const maybeChildrenLength = maybeChildren.length;
  if (maybeChildrenLength) {
    if (maybeChildrenLength === 1) {
      props.children = maybeChildren[0];
    } else {
      props.children = maybeChildren;
    }
  }

  return ReactElement(type, key, ref, props);
};

export const jsxDEV = (type: ElementType, config: any) => {
  let key: any = null;
  let ref: Ref = null;
  const props: Props = {};

  for (const prop in config) {
    const val = config[prop];
    if (prop === 'key') {
      if (val !== undefined) {
        key = '' + val;
      }
    }

    if (prop === 'ref') {
      if (val !== undefined) {
        ref = val;
      }
    }

    if ({}.hasOwnProperty.call(config, prop)) {
      props[prop] = val;
    }
  }

  return ReactElement(type, key, ref, props);
};

export const isValidElement = (element: ElementType) => {
  if (
    typeof element === 'object' &&
    element !== null &&
    element.$$typeof === REACT_ELEMENT_TYPE
  ) {
    return true;
  }
  return false;
};
