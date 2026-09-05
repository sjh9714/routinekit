import React, { useEffect, useRef, useState } from 'react';
export const inject = ['slots', 'sessions'];
export function apply(ctx) {
  function Panel({ useSessions, wide }) {
    const session = useSessions(s => s.current); const [open, setOpen] = useState(false); const frame = useRef(null); const close = useRef(null);
    useEffect(() => {
      if (!open) return;
      close.current?.focus();
      const keydown = e => { if (e.key === 'Escape') setOpen(false); };
      const message = async e => {
        if (e.origin !== location.origin || e.source !== frame.current?.contentWindow || e.data?.type !== 'routinekit' || e.data.session !== session || !session) return;
        let prompt;
        if (e.data.action === 'initialize') prompt = 'Call routine_list to initialize RoutineKit for this task. Do not start recording or execute other tools.';
        else if (e.data.action === 'run') {
          const { name, inputs } = e.data.args || {};
          if (!/^[a-z][a-z0-9-]{1,63}$/.test(name) || !inputs || typeof inputs !== 'object' || JSON.stringify(inputs).length > 8192) return;
          prompt = `Run the saved RoutineKit routine using routine_run with these exact arguments: ${JSON.stringify({ name, inputs_json: JSON.stringify(inputs) })}. Keep its human approval and all existing tool permissions enabled. Stop if it fails; do not substitute other tools.`;
        } else return;
        try { await ctx.sessions.binding(session)?.session.prompt([{ type: 'text', text: prompt }], 'queue'); } catch { /* The host conversation owns prompt error display. */ }
      };
      window.addEventListener('message', message); window.addEventListener('keydown', keydown);
      return () => { window.removeEventListener('message', message); window.removeEventListener('keydown', keydown); };
    }, [open, session]);
    return <><button type="button" title="Open RoutineKit" aria-label="Open RoutineKit" disabled={!session} onClick={() => setOpen(true)} style={{background:'transparent',border:0,color:'inherit',padding:8,cursor:'pointer'}}>↻ {wide ? 'RoutineKit' : ''}</button>{open && <div role="dialog" aria-modal="true" aria-label="RoutineKit workbench" style={{position:'fixed',inset:24,zIndex:1000,background:'#f3f4ee',borderRadius:16,boxShadow:'0 18px 90px #0005',display:'flex',flexDirection:'column',overflow:'hidden'}}><button ref={close} onClick={() => setOpen(false)} style={{alignSelf:'flex-end',margin:'8px 16px',padding:'6px 12px',border:'1px solid #ccc',borderRadius:6,cursor:'pointer'}}>Close · Esc</button><iframe key={session} ref={frame} title="RoutineKit workbench" src={`/routinekit/#session=${encodeURIComponent(session || '')}`} style={{width:'100%',flex:1,border:0}} /></div>}</>;
  }
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'routinekit', order: 42, label: 'RoutineKit', inject: () => ({}) }, Panel));
}
