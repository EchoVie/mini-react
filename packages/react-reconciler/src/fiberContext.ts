import { ReactContext } from 'shared/ReactTypes';

export interface ContextItem<Value> {
  context: ReactContext<Value>;
  memoizedState: Value;
  next: ContextItem<Value> | null;
}
