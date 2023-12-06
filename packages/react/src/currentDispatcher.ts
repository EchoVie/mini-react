import { Action } from 'shared/ReactTypes';

export type Dispatch<State> = (action: Action<State>) => void;
