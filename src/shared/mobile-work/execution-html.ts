import type { ExecutionJob } from './MobileExecutionService'

export const EXECUTION_MESSAGE_CHANNEL = 'chatbox-local-work'
export type ExecutionBridge = { type: 'react-native' } | { type: 'parent'; token: string }

export function buildExecutionHtml(
  job: ExecutionJob,
  workerSource: string,
  bridge: ExecutionBridge = { type: 'react-native' }
): string {
  // Opaque-origin WebViews cannot reliably resolve blob:null worker URLs.
  // Transfer the bundled runtime by message to keep the worker URL below WebView URL limits.
  const bootstrap = `self.onmessage=event=>{const {source,request}=event.data;(0,eval)(source);self.onmessage({data:request});};`
  const url = JSON.stringify(`data:text/javascript;charset=utf-8,${encodeURIComponent(bootstrap)}`)
  const source = JSON.stringify(workerSource).replace(/</g, '\\u003c')
  const request = JSON.stringify(job).replace(/</g, '\\u003c')
  const send =
    bridge.type === 'parent'
      ? `parent.postMessage(JSON.stringify({...data,channel:${JSON.stringify(EXECUTION_MESSAGE_CHANNEL)},token:${JSON.stringify(bridge.token).replace(/</g, '\\u003c')}}),'*')`
      : 'window.ReactNativeWebView.postMessage(JSON.stringify(data))'
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><script>
const send=data=>{${send}};
let worker;
let timer;
let finished=false;
const finish=data=>{if(finished)return;finished=true;clearTimeout(timer);worker?.terminate();send(data);};
const fail=()=>finish({id:${JSON.stringify(job.id).replace(/</g, '\\u003c')},result:{stdout:'',files:{},error:'Execution worker failed'}});
try {
worker=new Worker(${url});
worker.onmessage=e=>finish(e.data);
worker.onerror=fail;
worker.onmessageerror=fail;
timer=setTimeout(()=>finish({id:${JSON.stringify(job.id).replace(/</g, '\\u003c')},result:{stdout:'',files:{},error:'Execution timed out'}}),25000);
worker.postMessage({source:${source},request:${request}});
} catch { fail(); }
</script>`
}
