interface BatchConfig {
  transition: number | null;
}

export const ReactCurrentBatchConfig: BatchConfig = {
  transition: null
};

export default ReactCurrentBatchConfig;
