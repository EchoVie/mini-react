let syncQueue: ((...args: any) => void)[] | null = null;
let isFlushingSyncQueue = false;

export function scheduleSyncCallback(callback: (...args: any) => void) {
  if (syncQueue === null) {
    syncQueue = [callback];
  } else {
    syncQueue.push(callback);
  }
}

// 执行syncQueue
export function flushSyncCallbacks() {
  // 未在执行中且有同步任务
  if (!isFlushingSyncQueue && syncQueue) {
    isFlushingSyncQueue = true;
  }

  try {
    syncQueue?.forEach((callback) => callback());
  } catch (e) {
    // if (__DEV__) {
    //   console.error('flushSyncCallbacks报错', e);
    // }
  } finally {
    // 清空状态
    isFlushingSyncQueue = false;
    syncQueue = null;
  }
}
