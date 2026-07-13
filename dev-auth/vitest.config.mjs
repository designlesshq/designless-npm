// The adapters and gate run under Node (they use node:crypto and read Node
// request objects), so pin the node environment. The suite is pure + tiny, so
// default parallelism is fine.
export default {
  test: { environment: 'node' },
};
