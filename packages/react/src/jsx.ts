import { ElementType, Key, Props } from 'shared/ReactTypes';
import { REACT_ELEMENT_TYPE, REACT_FRAGMENT_TYPE } from 'shared/ReactSymbols';

type Ref = any;

const ReactElement = (type: ElementType, key: Key, ref: Ref, props: Props) => {
  return {
    $$typeof: REACT_ELEMENT_TYPE,
    type,
    ref,
    key,
    props,
    __mark: 'echo'
  };
};

export const jsx = (type: ElementType, config: any, maybeKey: any) => {
  let key: any = null;
  let ref: Ref = null;
  const props: Props = {};

  if (maybeKey !== undefined) {
    key = '' + maybeKey;
  }

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

  return ReactElement(type, key, ref, props);
};

export const jsxDEV = jsx;

export const isValidElement = (object: any) => {
  return (
    typeof object === 'object' &&
    object !== null &&
    object.$$typeof === REACT_ELEMENT_TYPE
  );
};

export const createElement = (
  type: ElementType,
  config: any,
  ...maybeChildren: any
) => {
  console.log('createElement', createElement);

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

    const maybeChildrenLength = maybeChildren.length;
    if (maybeChildrenLength) {
      if (maybeChildrenLength === 1) {
        props.children = maybeChildren[0];
      } else {
        props.children = maybeChildren;
      }
    }
  }

  return ReactElement(type, key, ref, props);
};

export const Fragment = REACT_FRAGMENT_TYPE;
