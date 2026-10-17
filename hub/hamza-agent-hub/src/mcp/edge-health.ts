/** Fixed host only: callers cannot turn health checks into SSRF. */
export async function edgeHealth() {
  try {
    const res = await fetch('https://hub.imdifferent01.com/healthz', {redirect:'error', signal:AbortSignal.timeout(3000)});
    const payload = res.ok ? await res.json() as {ok?:boolean} : {};
    return {ok:res.ok && payload.ok===true, status:res.status, host:'hub.imdifferent01.com'};
  } catch { return {ok:false, host:'hub.imdifferent01.com', error:'edge unavailable / الطرف غير متاح'}; }
}
