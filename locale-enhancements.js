/* Iconia locale runtime enhancements: dynamic progress/error translation. */
(function(){
  const run=()=>{
    const t=window.iconiaT?.(); if(!t)return;
    const p=document.getElementById('liveProgress');
    if(p){const v=p.textContent||''; if(/考えています|Thinking|생각|思考/.test(v))p.textContent=t.thinking; else if(/作成中|Creating|생성|制作/.test(v))p.textContent=t.creating; else if(/仕上げています|Finishing|마무리|完善/.test(v))p.textContent=t.finishing;}
    document.querySelectorAll('.error').forEach(e=>{if(/うまく処理できませんでした|Something went wrong|처리하지 못했습니다|处理失败|處理失敗/.test(e.textContent||''))e.textContent=t.error;});
  };
  setInterval(run,250); run();
})();
