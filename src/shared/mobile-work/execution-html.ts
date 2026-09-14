import type { ExecutionJob } from './MobileExecutionService'

export const EXECUTION_MESSAGE_CHANNEL = 'chatbox-local-work'
export type ExecutionBridge = { type: 'react-native' } | { type: 'parent'; token: string }

export function buildExecutionHtml(
  job: ExecutionJob,
  workerSource: string,
  bridge: ExecutionBridge = { type: 'react-native' }
): string {
  const source = JSON.stringify(workerSource).replace(/</g, '\\u003c')
  const request = JSON.stringify(job).replace(/</g, '\\u003c')
  const send =
    bridge.type === 'parent'
      ? `parent.postMessage(JSON.stringify({...data,channel:${JSON.stringify(EXECUTION_MESSAGE_CHANNEL)},token:${JSON.stringify(bridge.token).replace(/</g, '\\u003c')}}),'*')`
      : 'window.ReactNativeWebView.postMessage(JSON.stringify(data))'
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; worker-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none'"><script>
const send=data=>{${send}};
const url=URL.createObjectURL(new Blob([${source}],{type:'text/javascript'}));
const worker=new Worker(url); URL.revokeObjectURL(url);
let finished=false;
const finish=data=>{if(finished)return;finished=true;worker.terminate();send(data);};
worker.onmessage=e=>finish(e.data);
worker.onerror=()=>finish({id:${JSON.stringify(job.id).replace(/</g, '\\u003c')},result:{stdout:'',files:{},error:'Execution worker failed'}});
worker.postMessage(${request});
setTimeout(()=>finish({id:${JSON.stringify(job.id).replace(/</g, '\\u003c')},result:{stdout:'',files:{},error:'Execution timed out'}}),25000);
</script>`
}
