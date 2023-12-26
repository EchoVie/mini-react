import {
  createElement as createElementFn,
  isValidElement as isValidElementFn
} from './src/jsx';
import currentDispatcher, {
  Dispatcher,
  resolveDispatcher
} from './src/currentDispatcher';
import currentBatchConfig from './src/currentBatchConfig';

export { createContext } from './src/context';
export { lazy } from './src/lazy';
export { memo } from './src/memo';
export const version = '0.0.0';
// TODO 根据环境区分使用jsx/jsxDEV
export const createElement = createElementFn;
export const isValidElement = isValidElementFn;
export {
  REACT_FRAGMENT_TYPE as Fragment,
  REACT_SUSPENSE_TYPE as Suspense,
  currentBatchConfig
} from 'shared/ReactSymbols';
// 内部数据共享层
export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = {
  currentDispatcher,
  currentBatchConfig
};

export const useState: Dispatcher['useState'] = (initialState) => {
  const dispatcher = resolveDispatcher();
  return dispatcher.useState(initialState);
};

export const useEffect: Dispatcher['useEffect'] = (create, deps) => {
  const dispatcher = resolveDispatcher();
  return dispatcher.useEffect(create, deps);
};

export const useMemo: Dispatcher['useMemo'] = (nextCreate, deps) => {
  const dispatcher = resolveDispatcher();
  return dispatcher.useMemo(nextCreate, deps);
};

export const useRef: Dispatcher['useRef'] = (initialState) => {
  const dispatcher = resolveDispatcher();
  return dispatcher.useRef(initialState);
};

export const useCallback: Dispatcher['useCallback'] = (nextCreate, deps) => {
  const dispatcher = resolveDispatcher();
  return dispatcher.useCallback(nextCreate, deps);
};

export const useTransition: Dispatcher['useTransition'] = () => {
  const dispatcher = resolveDispatcher();
  return dispatcher.useTransition();
};

export const useContext: Dispatcher['useContext'] = (context) => {
  const dispatcher = resolveDispatcher();
  return dispatcher.useContext(context);
};

export const use: Dispatcher['use'] = (usable) => {
  const dispatcher = resolveDispatcher();
  return dispatcher.use(usable);
};
