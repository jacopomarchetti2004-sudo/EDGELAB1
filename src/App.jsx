import { useState, useRef, useEffect, useCallback } from "react";
import { db } from './db.js';

// ── TEMA ─────────────────────────────────────────────────────────────────────
const L={bg:"#F7F7F5",sb:"#FFFFFF",card:"#FFFFFF",bd:"#E8E8E5",bdl:"#F0F0ED",tx:"#111827",txm:"#6B7280",txs:"#9CA3AF",ac:"#4F46E5",nav:"#F3F3F0",tag:"#F3F3F0",inp:"#FAFAF8",inpb:"#E0E0DC",gr:"#16A34A",rd:"#DC2626",am:"#D97706",bl:"#2563EB"};
const D={bg:"#0F1117",sb:"#13151B",card:"#1A1D26",bd:"#262A36",bdl:"#1E2230",tx:"#F1F0EE",txm:"#6B7280",txs:"#4B5563",ac:"#6366F1",nav:"#1F2230",tag:"#262A36",inp:"#1F2230",inpb:"#363A48",gr:"#22C55E",rd:"#EF4444",am:"#F59E0B",bl:"#60A5FA"};

// ── ASSET DATABASE ────────────────────────────────────────────────────────────
const MKT={"Forex":{unit:"Lotti",assets:["EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","NZDUSD","USDCAD","EURGBP","EURJPY","GBPJPY"]},"Indici & Futures":{unit:"Contratti",assets:["NAS100","US500","US30","DAX40","FTSE100","CAC40","ES1!","NQ1!","CL1!","GC1!"]},"Crypto":{unit:"Contratti",assets:["BTCUSD","ETHUSD","SOLUSD","BNBUSD","XRPUSD"]},"Commodities":{unit:"Contratti",assets:["XAUUSD","XAGUSD","USOIL","UKOIL","NATGAS"]}};
const ALL_ASSETS=["EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","NZDUSD","USDCAD","EURGBP","EURJPY","GBPJPY","NAS100","US500","US30","DAX40","FTSE100","BTCUSD","ETHUSD","SOLUSD","XAUUSD","XAGUSD","USOIL"];

// ── NAVIGAZIONE ───────────────────────────────────────────────────────────────
const NAVITEMS=[
  {id:"dashboard",label:"Dashboard",icon:"▣",s:null},
  {id:"strategie",label:"Strategie",icon:"◈",s:"TRADING"},
  {id:"conti",label:"Conti",icon:"◎",s:"TRADING"},
  {id:"journal",label:"Journal",icon:"≡",s:"TRADING"},
  {id:"form",label:"Nuovo Trade",icon:"＋",s:"TRADING"},
  {id:"analytics",label:"Analytics",icon:"∿",s:"ANALISI"},
  {id:"ottimizzazione",label:"Ottimizzazione",icon:"⇌",s:"ANALISI"},
  {id:"sim-gestione",label:"Sim. Gestione",icon:"⟳",s:"ANALISI"},
  {id:"sim-cap",label:"Sim. Capitale",icon:"▲",s:"SIMULAZIONI"},
  {id:"monte-carlo",label:"Monte Carlo",icon:"≈",s:"SIMULAZIONI"},
  {id:"backtest",label:"Backtest",icon:"◧",s:"LABORATORIO"},
  {id:"coach",label:"Coach",icon:"◉",s:"ALTRO"},
  {id:"report",label:"Report",icon:"☰",s:"ALTRO"},
  {id:"impostazioni",label:"Impostazioni",icon:"◌",s:"ALTRO"}
];

// ── CALCOLI CORE ──────────────────────────────────────────────────────────────
function calcR(entry, sl, exit, dir) {
  if(!entry||!sl||!exit) return 0;
  const e=parseFloat(entry), s=parseFloat(sl), x=parseFloat(exit);
  if(isNaN(e)||isNaN(s)||isNaN(x)) return 0;
  const risk=Math.abs(e-s);
  if(risk===0) return 0;
  const pnl=dir==="L"?(x-e):(e-x);
  return parseFloat((pnl/risk).toFixed(2));
}

// Calcola R ponderato tenendo conto dei parziali
// Se ci sono parziali: R_tot = somma(R_parziale * %chiusa) + R_exit * %residua
function calcRConParziali(entry, sl, exit, dir, parziali) {
  if(!parziali||parziali.length===0) return calcR(entry,sl,exit,dir);
  const e=parseFloat(entry), s=parseFloat(sl);
  if(isNaN(e)||isNaN(s)) return calcR(entry,sl,exit,dir);
  const risk=Math.abs(e-s);
  if(risk===0) return 0;
  let totPerc=0;
  let weightedR=0;
  parziali.forEach(function(p){
    const prezzo=parseFloat(p.prezzo);
    const perc=parseFloat(p.percentuale)||0;
    if(!isNaN(prezzo)&&perc>0){
      const pnl=dir==="L"?(prezzo-e):(e-prezzo);
      const r=pnl/risk;
      weightedR+=r*(perc/100);
      totPerc+=perc;
    }
  });
  // residuo chiuso all'exit finale
  const residuo=Math.max(0,100-totPerc);
  if(residuo>0){
    const exitR=calcR(entry,sl,exit,dir);
    weightedR+=exitR*(residuo/100);
  }
  return parseFloat(weightedR.toFixed(2));
}

function calcIntegrityScore(trade){
  let score=0;
  // +50pt inserimento tempestivo (entro 2h dalla chiusura)
  if(trade.created_at&&trade.data_chiusura){
    const diffH=(new Date(trade.created_at)-new Date(trade.data_chiusura))/(1000*60*60);
    if(diffH<=2) score+=50;
    else score+=Math.max(0,50-Math.floor(diffH/6)*10);
  } else {
    score+=25; // nessun created_at → punteggio neutro
  }
  // +30pt dati completi (MAE + MFE + screenshot)
  let dataPoints=0;
  if(trade.mae!=null) dataPoints++;
  if(trade.mfe!=null) dataPoints++;
  if(trade.screenshot_url) dataPoints++;
  score+=Math.round((dataPoints/3)*30);
  // +20pt note psicologiche >50 caratteri
  if(trade.note_psi&&trade.note_psi.length>50) score+=20;
  else if(trade.note_psi&&trade.note_psi.length>10) score+=10;
  return Math.min(100,score);
}

function calcMetrics(trades) {
  if(!trades||trades.length===0) return {total:0,wins:0,losses:0,be:0,wr:0,pf:0,exp:0,avgWin:0,avgLoss:0,maxDD:0,streak:{cur:0,maxW:0,maxL:0},totalR:0};
  const wins=trades.filter(function(t){return t.r_result>0;});
  const losses=trades.filter(function(t){return t.r_result<0;});
  const bes=trades.filter(function(t){return t.r_result===0;});
  const wr=trades.length>0?Math.round((wins.length/trades.length)*100):0;
  const avgWin=wins.length>0?wins.reduce(function(s,t){return s+t.r_result;},0)/wins.length:0;
  const avgLoss=losses.length>0?Math.abs(losses.reduce(function(s,t){return s+t.r_result;},0)/losses.length):0;
  const grossWin=wins.reduce(function(s,t){return s+t.r_result;},0);
  const grossLoss=Math.abs(losses.reduce(function(s,t){return s+t.r_result;},0));
  const pf=grossLoss>0?parseFloat((grossWin/grossLoss).toFixed(2)):grossWin>0?999:0;
  const exp=parseFloat((trades.reduce(function(s,t){return s+t.r_result;},0)/trades.length).toFixed(2));
  const totalR=parseFloat(trades.reduce(function(s,t){return s+t.r_result;},0).toFixed(2));
  // equity curve e drawdown
  let peak=0,maxDD=0,eq=0;
  trades.forEach(function(t){eq+=t.r_result;if(eq>peak)peak=eq;const dd=peak-eq;if(dd>maxDD)maxDD=dd;});
  // streak
  let curW=0,curL=0,maxW=0,maxL=0,cur=0;
  trades.forEach(function(t){
    if(t.r_result>0){curW++;curL=0;if(curW>maxW)maxW=curW;cur=curW;}
    else if(t.r_result<0){curL++;curW=0;if(curL>maxL)maxL=curL;cur=-curL;}
    else{curW=0;curL=0;}
  });
  const integrityScore=trades.length>0?Math.round(trades.reduce(function(s,t){return s+calcIntegrityScore(t);},0)/trades.length):0;
  return {total:trades.length,wins:wins.length,losses:losses.length,be:bes.length,wr,pf,exp,avgWin:parseFloat(avgWin.toFixed(2)),avgLoss:parseFloat(avgLoss.toFixed(2)),maxDD:parseFloat(maxDD.toFixed(2)),streak:{cur,maxW,maxL},totalR,integrityScore};
}

// helper: { conto_id: capitale_iniziale }
function makeCapMap(conti){const m={};(conti||[]).forEach(function(cn){const cap=cn.capitale_iniziale||cn.cap_iniz||0;if(cn.id&&cap>0)m[cn.id]=cap;});return m;}

function buildEquityCurve(trades, capMap) {
  let eqR=0, eqEur=0, eqPct=0;
  return [{i:0,r:0,eur:0,pct:0}].concat(trades.map(function(t,i){
    eqR+=t.r_result;
    const pnl=t.pnl_eur||0;
    eqEur+=pnl;
    const cap=capMap&&capMap[t.conto_id]>0?capMap[t.conto_id]:null;
    const pctTrade=cap?((pnl/cap)*100):0;
    eqPct+=pctTrade;
    return {i:i+1,r:parseFloat(eqR.toFixed(2)),eur:parseFloat(eqEur.toFixed(2)),pct:parseFloat(eqPct.toFixed(2))};
  }));
}

function fmtR(r){return (r>=0?"+":"")+r+"R";}
function fmtDate(iso){if(!iso)return "—";const d=new Date(iso);return d.getDate()+" "+(["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"][d.getMonth()]);}


// Giorni settimana per grafico (lunedì–venerdì tipici per trading)
const WEEKDAYS=["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
function getDayLabel(iso){if(!iso)return "?";return WEEKDAYS[new Date(iso).getDay()];}

// ── Fuso orario configurabile ──────────────────────────────────────────────
// Lista fusi orari disponibili
const TZ_LIST=[
  {label:"UTC (London invernale)",offset:0},
  {label:"CET — Europa Centrale (UTC+1)",offset:1},
  {label:"CEST — Europa Centrale estate (UTC+2)",offset:2},
  {label:"EET — Europa Orientale (UTC+2)",offset:2},
  {label:"GMT — Londra (UTC+0)",offset:0},
  {label:"BST — Londra estate (UTC+1)",offset:1},
  {label:"EST — New York invernale (UTC-5)",offset:-5},
  {label:"EDT — New York estate (UTC-4)",offset:-4},
  {label:"CST — Chicago invernale (UTC-6)",offset:-6},
  {label:"JST — Tokyo (UTC+9)",offset:9},
  {label:"AEST — Sydney (UTC+10)",offset:10},
  {label:"SGT — Singapore (UTC+8)",offset:8},
];
// Legge offset configurato dall'utente (default: browser auto)
function getUserTzOffset(){
  const saved=localStorage.getItem("el_tz_offset");
  if(saved!=null&&saved!=="auto") return parseInt(saved,10);
  return null; // null = usa browser locale
}
function getHourWithTz(iso){
  if(!iso) return 0;
  const d=new Date(iso);
  const tzOffset=getUserTzOffset();
  if(tzOffset!=null){
    // Converti a UTC, poi aggiungi offset configurato
    const utcMs=d.getTime()+(d.getTimezoneOffset()*60000);
    const localMs=utcMs+(tzOffset*3600000);
    return new Date(localMs).getUTCHours();
  }
  return d.getHours(); // browser locale
}
function getSessioneWithTz(iso){
  if(!iso) return "Asian";
  const h=getHourWithTz(iso);
  const m=new Date(iso).getMinutes();
  const hm=h+(m/60);
  const tzOffset=getUserTzOffset();
  // Usa offset configurato o browser
  const effectiveOffset=tzOffset!=null?tzOffset:(-new Date(iso).getTimezoneOffset()/60);
  // Orari sessione base Italia (UTC+1): Asian 23-8, London 8-14:30, NY 14:30-22
  // Adattati all'offset configurato rispetto a UTC+1
  const delta=effectiveOffset-1; // differenza da CET base
  const londonStart=8+delta;
  const londonEnd=14.5+delta;
  const nyStart=14.5+delta;
  const nyEnd=22+delta;
  if(hm>=londonStart&&hm<londonEnd) return "London";
  if(hm>=nyStart&&hm<nyEnd) return "NY";
  return "Asian";
}

// ── CALCOLO % CORRETTO ────────────────────────────────────────────────────────
// makeFmtVal: formatta un valore in R / $ / %
// pnlVal = valore monetario singolo o totale
// capVal = capitale di riferimento PER QUEL CONTESTO (usare sempre il capitale corretto)
function makeFmtVal(unit, totalPnl, capConto){
  return function(r, pnlSingolo){
    if(unit==="R") return fmtR(r);
    if(unit==="$"){
      const p=pnlSingolo!=null?pnlSingolo:totalPnl;
      return (p>=0?"+":"")+"$"+Math.abs(p).toFixed(0);
    }
    if(unit==="%"){
      const p=pnlSingolo!=null?pnlSingolo:totalPnl;
      // capConto = capitale del conto corretto passato dal chiamante
      if(capConto>0) return (p>=0?"+":"")+((p/capConto)*100).toFixed(2)+"%";
      return fmtR(r);
    }
    return fmtR(r);
  };
}

// calcPctTrades: calcola la % cumulativa corretta su un array di trade
// usando per ogni trade il capitale del suo conto specifico
function calcTotalPct(trades, capMap){
  let tot=0;
  trades.forEach(function(t){
    const cap=capMap&&capMap[t.conto_id]>0?capMap[t.conto_id]:0;
    if(cap>0) tot+=((t.pnl_eur||0)/cap)*100;
  });
  return parseFloat(tot.toFixed(2));
}

// fmtPct: formatta un numero come percentuale con segno
function fmtPct(v){return (v>=0?"+":"")+v.toFixed(2)+"%";}


function Badge({v,c}){
  if(v>0) return <span style={{color:c.gr,fontWeight:700}}>{fmtR(v)}</span>;
  if(v<0) return <span style={{color:c.rd,fontWeight:700}}>{fmtR(v)}</span>;
  return <span style={{color:c.txm,fontWeight:700}}>0R</span>;
}

function EqChartSVG({curve,c,h=100,unit}){
  if(!curve||curve.length<2) return <div style={{height:h,display:"flex",alignItems:"center",justifyContent:"center",color:c.txm,fontSize:11}}>Nessun dato</div>;
  const W=500; const PAD_L=40; const PAD_B=18;
  // seleziona la serie corretta in base all unit
  function getVal(p){return unit==="$"?p.eur:unit==="%"?p.pct:p.r;}
  const vals=curve.map(getVal);
  const minV=Math.min.apply(null,vals);
  const maxV=Math.max.apply(null,vals);
  const range=maxV-minV||1;
  const chartH=h-PAD_B; const chartW=W-PAD_L;
  const toX=function(i){return PAD_L+((i/(curve.length-1))*chartW);};
  const toY=function(v){return chartH-8-((v-minV)/range)*(chartH-16);};
  const pts=curve.map(function(p,i){return toX(i)+","+toY(getVal(p));}).join(" ");
  const area=toX(0)+","+(chartH-2)+" "+curve.map(function(p,i){return toX(i)+","+toY(getVal(p));}).join(" ")+" "+toX(curve.length-1)+","+(chartH-2);
  const lastVal=vals[vals.length-1];
  const color=lastVal>=0?c.gr:c.rd;
  const midV=parseFloat(((maxV+minV)/2).toFixed(2));
  const suffix=unit==="$"?"$":unit==="%"?"%":"R";
  const fmtLabel=function(v){return unit==="%"?(v>=0?"+":"")+v.toFixed(1)+"%":unit==="$"?(v>=0?"+":"-")+"$"+Math.abs(v).toFixed(0):(v>=0?"+":"")+v+"R";};
  return (
    <svg width="100%" viewBox={"0 0 "+W+" "+h} style={{overflow:"visible"}}>
      <defs><linearGradient id={"eg"+h} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.15"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
      {/* asse Y labels */}
      <text x={PAD_L-3} y={toY(maxV)+3} textAnchor="end" fontSize="8" fill={c.txm}>{fmtLabel(maxV)}</text>
      <text x={PAD_L-3} y={toY(midV)+3} textAnchor="end" fontSize="8" fill={c.txm}>{fmtLabel(midV)}</text>
      <text x={PAD_L-3} y={toY(minV)+3} textAnchor="end" fontSize="8" fill={c.txm}>{fmtLabel(minV)}</text>
      {/* linea zero */}
      {minV<0&&maxV>0&&<line x1={PAD_L} y1={toY(0)} x2={W} y2={toY(0)} stroke={c.bd} strokeWidth="1" strokeDasharray="3,3"/>}
      {/* asse X labels */}
      <text x={toX(0)} y={h-3} textAnchor="middle" fontSize="7" fill={c.txm}>0</text>
      <text x={toX(Math.floor((curve.length-1)/2))} y={h-3} textAnchor="middle" fontSize="7" fill={c.txm}>{Math.floor((curve.length-1)/2)}</text>
      <text x={toX(curve.length-1)} y={h-3} textAnchor="middle" fontSize="7" fill={c.txm}>{curve.length-1}</text>
      <polygon points={area} fill={"url(#eg"+h+")"}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"/>
      <circle cx={toX(curve.length-1)} cy={toY(lastVal)} r="4" fill={color}/>
    </svg>
  );
}

// ── SIDEBAR ───────────────────────────────────────────────────────────────────
function EdgeLabLogo({size=28}){
  return(
    <svg width={size} height={size} viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="elg1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366F1"/>
          <stop offset="100%" stopColor="#4338CA"/>
        </linearGradient>
        <linearGradient id="elg2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#818CF8"/>
          <stop offset="100%" stopColor="#6366F1"/>
        </linearGradient>
      </defs>
      <polygon points="100,12 178,56 178,144 100,188 22,144 22,56" fill="url(#elg1)" opacity="0.18"/>
      <polygon points="100,12 178,56 178,144 100,188 22,144 22,56" fill="none" stroke="url(#elg1)" strokeWidth="2" opacity="0.55"/>
      <rect x="58" y="68" width="72" height="10" rx="2" fill="url(#elg1)"/>
      <rect x="58" y="95" width="52" height="10" rx="2" fill="url(#elg2)"/>
      <rect x="58" y="122" width="72" height="10" rx="2" fill="url(#elg1)"/>
      <rect x="58" y="68" width="10" height="64" rx="2" fill="url(#elg1)"/>
      <circle cx="148" cy="72" r="6" fill="#818CF8" opacity="0.95"/>
      <circle cx="148" cy="72" r="2.5" fill="#E0E7FF"/>
    </svg>
  );
}

function Sidebar({active,setActive,setScreen,dark,setDark,c,trades,strategie,conti}){
  let lastSection=null;
  const badges={strategie:strategie.length,conti:conti.length,coach:3};
  return (
    <div style={{width:210,minWidth:210,background:c.sb,borderRight:"1px solid "+c.bd,display:"flex",flexDirection:"column",height:"100vh",flexShrink:0}}>
      <div style={{padding:"14px 12px 10px",display:"flex",alignItems:"center",gap:9}}>
        <EdgeLabLogo size={28}/>
        <div>
          <div style={{fontSize:14,fontWeight:800,color:c.tx,letterSpacing:"-0.03em"}}>EdgeLab</div>
          <div style={{fontSize:8,color:c.txm,letterSpacing:"0.06em",textTransform:"uppercase",fontWeight:500,marginTop:1}}>Trade smarter, not harder</div>
        </div>
      </div>
      <div style={{padding:"0 9px 10px"}}>
        <button onClick={function(){setScreen("form");setActive("");}} style={{width:"100%",padding:"7px 12px",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
          <span style={{fontSize:15}}>+</span> Nuovo Trade
        </button>
      </div>
      <div style={{height:1,background:c.bd,margin:"0 9px"}}/>
      <nav style={{flex:1,padding:"6px",overflowY:"auto"}}>
        {NAVITEMS.map(function(item){
          const isA=active===item.id;
          const showSection=item.s&&item.s!==lastSection;
          if(item.s) lastSection=item.s;
          const badge=badges[item.id];
          return (
            <div key={item.id}>
              {showSection&&<div style={{fontSize:8,fontWeight:700,color:c.txs,letterSpacing:"0.1em",padding:"7px 8px 2px"}}>{item.s}</div>}
              <button onClick={function(){setActive(item.id);setScreen(item.id);}} style={{display:"flex",alignItems:"center",gap:7,width:"100%",padding:"6px 9px",borderRadius:6,border:"none",cursor:"pointer",textAlign:"left",background:isA?c.nav:"transparent",color:isA?c.tx:c.txm,fontSize:12,fontFamily:"inherit",fontWeight:isA?600:400,marginBottom:1}}>
                <span style={{fontSize:11}}>{item.icon}</span>
                <span style={{flex:1}}>{item.label}</span>
                {badge>0&&<span style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:20,background:isA?c.ac+"18":c.tag,color:isA?c.ac:c.txm}}>{badge}</span>}
              </button>
            </div>
          );
        })}
      </nav>
      <div style={{padding:"8px 12px",borderTop:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <div style={{width:26,height:26,borderRadius:"50%",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#fff"}}>M</div>
          <div><div style={{fontSize:11,fontWeight:600,color:c.tx}}>Marco</div><div style={{fontSize:9,color:c.txm}}>{trades.length} trade</div></div>
        </div>
        <button onClick={function(){setDark(!dark);}} style={{width:26,height:26,borderRadius:6,border:"1px solid "+c.bd,background:c.tag,cursor:"pointer",fontSize:12,color:c.txm,display:"flex",alignItems:"center",justifyContent:"center"}}>{dark?"☀":"☾"}</button>
      </div>
    </div>
  );
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function Dashboard({c,setScreen,trades,strategie,conti}){
  const [selConti,setSelConti]=useState([]);
  const [selStrat,setSelStrat]=useState([]);
  const [unit,setUnit]=useState("R");
  function toggleC(id){setSelConti(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  function toggleS(id){setSelStrat(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  const filtered=trades.filter(function(t){
    if(selConti.length>0&&!selConti.includes(t.conto_id)) return false;
    if(selStrat.length>0&&!selStrat.includes(t.strategia_id)) return false;
    return true;
  });
  const metrics=calcMetrics(filtered);
  const capMap=makeCapMap(conti);
  const curve=buildEquityCurve(filtered,capMap);
  const totalPnl=filtered.reduce(function(s,t){return s+(t.pnl_eur||0);},0);
  // % corretta: somma di (pnl_trade/cap_conto_trade) per ogni trade
  const totalPct=calcTotalPct(filtered,capMap);
  const pctPerTrade=filtered.length>0?(totalPct/filtered.length):0;
  const recent=filtered.slice().sort(function(a,b){return new Date(b.data_apertura)-new Date(a.data_apertura);}).slice(0,5);
  const stratStats=strategie.map(function(s){
    const st=filtered.filter(function(t){return t.strategia_id===s.id;});
    const m=calcMetrics(st);
    const stPnl=st.reduce(function(sum,t){return sum+(t.pnl_eur||0);},0);
    const stPct=calcTotalPct(st,capMap);
    return {...s,_trades:st.length,_wr:m.wr,_pf:m.pf,_r:m.totalR,_pnl:stPnl,_pct:stPct};
  }).filter(function(s){return s._trades>0;});
  // capConto usato solo per DD%: prendiamo il capitale totale dei conti filtrati
  const capConto=conti.filter(function(cn){return selConti.length===0||selConti.includes(cn.id);}).reduce(function(s,cn){return s+(cn.capitale_iniziale||cn.cap_iniz||0);},0);
  // fmtVal: per R e $ usa logica precedente; per % usa totalPct direttamente
  function fmtVal(r, pnlSingolo, pctSingolo){
    if(unit==="R") return fmtR(r);
    if(unit==="$"){const p=pnlSingolo!=null?pnlSingolo:totalPnl;return (p>=0?"+":"")+"$"+Math.abs(p).toFixed(0);}
    if(unit==="%"){const p=pctSingolo!=null?pctSingolo:totalPct;return fmtPct(p);}
    return fmtR(r);
  }
  // ONBOARDING
  const isNew=trades.length===0&&strategie.length===0&&conti.length===0;
  if(isNew) return(
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:40,gap:0}}>
      <div style={{fontSize:36,marginBottom:16}}>⚡</div>
      <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:12,justifyContent:"center"}}>
              <EdgeLabLogo size={44}/>
              <div style={{textAlign:"left"}}>
                <div style={{fontSize:26,fontWeight:800,letterSpacing:"-0.04em",color:c.tx}}>EdgeLab</div>
                <div style={{fontSize:9,color:"#6366F1",letterSpacing:"0.12em",textTransform:"uppercase",fontWeight:600}}>Trade smarter, not harder</div>
              </div>
            </div>
      <div style={{fontSize:13,color:c.txm,textAlign:"center",maxWidth:420,marginBottom:32,lineHeight:1.7}}>Il tuo laboratorio personale per analizzare, ottimizzare e migliorare il tuo trading. Segui questi 3 passi per iniziare.</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14,width:"100%",maxWidth:640,marginBottom:28}}>
        {[{n:"1",icon:"◈",t:"Crea una Strategia",d:"Definisci le regole del tuo setup con checklist personalizzata.",btn:"Vai alle Strategie",sc:"strategie",col:"#4F46E5"},{n:"2",icon:"◎",t:"Aggiungi un Conto",d:"Reale, Demo o Prop Firm. Collegalo alla tua strategia.",btn:"Vai ai Conti",sc:"conti",col:"#0F766E"},{n:"3",icon:"≡",t:"Inserisci il primo Trade",d:"Con entry, SL, exit e opzionalmente MAE/MFE per le analytics.",btn:"Nuovo Trade",sc:"form",col:"#D97706"}].map(function(step){return(
          <div key={step.n} style={{background:c.card,borderRadius:14,padding:"20px 18px",border:"1px solid "+c.bd,display:"flex",flexDirection:"column",gap:8}}>
            <div style={{width:32,height:32,borderRadius:8,background:step.col+"15",border:"1px solid "+step.col+"40",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:step.col}}>{step.n}</div>
            <div style={{fontSize:13,fontWeight:700,marginTop:4}}>{step.t}</div>
            <div style={{fontSize:11,color:c.txm,lineHeight:1.6,flex:1}}>{step.d}</div>
            <button onClick={function(){setScreen(step.sc);}} style={{padding:"7px 0",borderRadius:8,background:step.col,border:"none",color:"#fff",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",marginTop:4}}>{step.btn}</button>
          </div>
        );})}
      </div>
      <div style={{fontSize:10,color:c.txm}}>Puoi sempre tornare qui dalla sidebar. I tuoi dati sono salvati localmente nel browser.</div>
    </div>
  );
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"11px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:c.sb,flexShrink:0}}>
        <div><div style={{fontSize:15,fontWeight:700,letterSpacing:"-0.02em"}}>Dashboard</div><div style={{fontSize:10,color:c.txm,marginTop:1}}>{new Date().toLocaleDateString("it-IT",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div></div>
        <div style={{display:"flex",gap:2,background:c.tag,borderRadius:8,padding:2}}>
          {["R","$","%"].map(function(u){return <button key={u} onClick={function(){setUnit(u);}} style={{padding:"4px 10px",borderRadius:6,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:unit===u?700:400,background:unit===u?c.ac:"transparent",color:unit===u?"#fff":c.txm}}>{u}</button>;})}
        </div>
      </div>
      {/* FILTRI */}
      <div style={{padding:"8px 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:14,flexShrink:0,flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:9,fontWeight:700,color:c.txm,marginRight:2}}>CONTO</span>
          {conti.map(function(cn){const s=selConti.includes(cn.id);return <button key={cn.id} onClick={function(){toggleC(cn.id);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+(s?c.ac:c.bd),background:s?c.ac+"15":"transparent",color:s?c.ac:c.txm,fontSize:11,fontWeight:s?700:400,cursor:"pointer",fontFamily:"inherit"}}>{cn.nome}</button>;})}
        </div>
        <div style={{width:1,background:c.bd}}/>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:9,fontWeight:700,color:c.txm,marginRight:2}}>STRATEGIA</span>
          {strategie.map(function(s){const sel=selStrat.includes(s.id);return <button key={s.id} onClick={function(){toggleS(s.id);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+(sel?c.ac:c.bd),background:sel?c.ac+"15":"transparent",color:sel?c.ac:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{s.nome}</button>;})}
        </div>
        {(selConti.length>0||selStrat.length>0)&&<button onClick={function(){setSelConti([]);setSelStrat([]);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>✕ Reset</button>}
      </div>
      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:12}}>
          {(function(){
            // DD in %: calcola il max drawdown cumulativo sulla curva %
            const ddCurve=curve.map(function(p){return p.pct;});
            let peak=0,maxDDpct=0;
            ddCurve.forEach(function(v){if(v>peak)peak=v;const dd=peak-v;if(dd>maxDDpct)maxDDpct=dd;});
            maxDDpct=parseFloat(maxDDpct.toFixed(2));
            return [
              {l:"P/L Totale",v:fmtVal(metrics.totalR,totalPnl,totalPct),col:metrics.totalR>=0?c.gr:c.rd,tt:"Il tuo risultato complessivo nel periodo selezionato. In R misura quante unità di rischio hai guadagnato — è la misura più affidabile perché non dipende dalla size. In € o $ è il guadagno monetario reale. In % è il rendimento sul capitale del conto. Se è positivo stai guadagnando, se è negativo stai perdendo capitale reale."},
              {l:"Win Rate",v:metrics.wr+"%",col:metrics.wr>=50?c.gr:c.rd,tt:"La percentuale dei tuoi trade che si chiudono in profitto. Un numero alto sembra positivo, ma può ingannare: puoi avere un win rate del 70% e perdere soldi se le tue perdite sono molto più grandi delle vincite. Un win rate del 40% può essere ottimo se ogni vincita vale 3 volte ogni perdita. Guardalo sempre insieme all'expectancy e al profit factor per avere un quadro completo."},
              {l:"Profit Factor",v:metrics.pf,col:metrics.pf>=1.5?c.gr:metrics.pf>=1?c.am:c.rd,tt:"Il profit factor ti dice quanti euro guadagni per ogni euro che perdi, in totale. Se è 2.0 significa che per ogni 1€ perso ne guadagni 2€ — la strategia è profittevole. Sopra 1.5 è considerato buono. Sotto 1.0 significa che stai perdendo complessivamente. È una delle metriche più importanti perché sintetizza in un numero solo se la tua strategia ha un edge reale."},
              {l:"Expectancy",v:fmtVal(metrics.exp,totalPnl/Math.max(filtered.length,1),pctPerTrade),col:metrics.exp>=0?c.gr:c.rd,tt:"L'expectancy è il guadagno medio che puoi aspettarti da ogni singolo trade, tenendo conto sia di quando vinci sia di quando perdi. È la metrica più importante per valutare una strategia a lungo termine: un'expectancy positiva significa che più trade fai, più guadagni in media. Un'expectancy di +0.5R significa che ogni trade che apri, in media, ti porta mezzo R di profitto — anche considerando le perdite."},
              {l:"Max Drawdown",v:unit==="R"?"-"+metrics.maxDD+"R":unit==="%"?"-"+maxDDpct+"%":"-$"+(capConto>0?(metrics.maxDD/metrics.totalR*Math.abs(totalPnl)).toFixed(0):metrics.maxDD),col:c.rd,tt:"Il drawdown massimo mostra la perdita più grande che hai subito dal punto più alto del tuo conto fino al punto più basso successivo, prima di recuperare. È la misura del 'peggior momento' che hai vissuto. Un drawdown grande mette a dura prova la psicologia e può portarti a smettere troppo presto o a fare errori. Sapere qual è il tuo drawdown massimo storico ti aiuta a capire quanto devi essere resiliente per seguire la strategia."},
              {l:"Integrity Score",v:metrics.integrityScore+"/100",col:metrics.integrityScore>=70?c.gr:metrics.integrityScore>=40?c.am:c.rd,tt:"L'Integrity Score misura quanto sono completi e affidabili i dati che inserisci per ogni trade. Un punteggio alto (70+) significa che hai MAE/MFE compilati, note dettagliate e screenshot allegati — questo rende le analisi di ottimizzazione e le simulazioni molto più accurate. Un punteggio basso significa che stai lasciando campi vuoti e le analisi avanzate (ottimizzazione TP, simulazioni) non possono lavorare correttamente."},
            ];
          })().map(function(m,i){return(
            <div key={i} style={{background:c.card,borderRadius:10,padding:"11px 13px",border:"1px solid "+c.bd}}>
              <div style={{fontSize:8,color:c.txm,fontWeight:600,letterSpacing:"0.05em",marginBottom:4,display:"flex",alignItems:"center",gap:2}}>{m.l.toUpperCase()}<Tooltip text={m.tt} c={c}/></div>
              <div style={{fontSize:17,fontWeight:700,color:m.col,letterSpacing:"-0.03em",lineHeight:1}}>{m.v}</div>
            </div>
          );})}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 280px",gap:10,marginBottom:10}}>
          <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:10,display:"flex",alignItems:"center",gap:4}}>Equity Curve<Tooltip c={c} text="Mostra come cresce (o scende) il tuo capitale trade dopo trade. Una curva che sale costantemente verso destra indica una strategia solida. Picchi e valli brusche indicano alta volatilità dei risultati. Il drawdown è la distanza dal massimo raggiunto fino al punto più basso successivo — più è profondo, più è difficile psicologicamente e finanziariamente da sostenere."/></div>
            <EqChartSVG curve={curve} c={c} h={100} unit={unit}/>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <div style={{background:c.card,borderRadius:12,padding:"12px 14px",border:"1px solid "+c.bd,flex:1}}>
              <div style={{fontSize:11,fontWeight:700,marginBottom:8}}>Per Strategia</div>
              {stratStats.length===0&&<div style={{fontSize:10,color:c.txm}}>Nessun dato</div>}
              {stratStats.map(function(s,i){return(
                <div key={s.id} style={{marginBottom:i<stratStats.length-1?8:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                    <span style={{fontSize:11,fontWeight:600}}>{s.nome}</span>
                    <span style={{fontSize:11,fontWeight:700,color:s._r>=0?c.gr:c.rd}}>{fmtVal(s._r,s._pnl,s._pct||0)}</span>
                  </div>
                  <div style={{height:3,borderRadius:2,background:c.bd}}><div style={{height:"100%",width:Math.min(s._wr,100)+"%",background:s._wr>=50?c.gr:c.rd,borderRadius:2}}/></div>
                  <div style={{fontSize:9,color:c.txm,marginTop:2}}>WR {s._wr}% · {s._trades} trade</div>
                  {i<stratStats.length-1&&<div style={{height:1,background:c.bd,margin:"6px 0"}}/>}
                </div>
              );})}
            </div>
          </div>
        </div>
        <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:700}}>Ultimi Trade</div>
            <span onClick={function(){setScreen("journal");}} style={{fontSize:10,color:c.ac,cursor:"pointer",fontWeight:500}}>Journal →</span>
          </div>
          {recent.length===0&&<div style={{fontSize:11,color:c.txm}}>Nessun trade ancora</div>}
          {recent.map(function(t,i){
            const strat=strategie.find(function(s){return s.id===t.strategia_id;});
            return(
              <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:i<recent.length-1?"1px solid "+c.bdl:"none"}}>
                <div style={{width:22,height:22,borderRadius:4,fontSize:8,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",background:t.direzione==="L"?c.gr+"18":c.rd+"18",color:t.direzione==="L"?c.gr:c.rd,border:"1px solid "+(t.direzione==="L"?c.gr+"44":c.rd+"44"),flexShrink:0}}>{t.direzione==="L"?"▲":"▼"}</div>
                <div style={{flex:1}}><div style={{fontSize:11,fontWeight:600}}>{t.asset}</div><div style={{fontSize:9,color:c.txm}}>{fmtDate(t.data_apertura)}{strat?" · "+strat.nome:""}</div></div>
                <div style={{textAlign:"right"}}>
                  <Badge v={t.r_result} c={c}/>
                  {t.pnl_eur!=null&&unit==="$"&&<div style={{fontSize:9,color:t.pnl_eur>=0?c.gr:c.rd}}>{t.pnl_eur>=0?"+":""}${Math.abs(t.pnl_eur).toFixed(0)}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── STRATEGIE ─────────────────────────────────────────────────────────────────
function Strategie({c,strategie,reload}){
  const [modal,setModal]=useState(false);
  const [editing,setEditing]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  const emptyForm=function(){return {nome:"",stato:"Attiva",tf:"M15",mercati:[],checklist:{bias:[],trigger:[],contesto:[],gestione:[]},note:""};};
  const [form,setForm]=useState(emptyForm());
  const [assetQ,setAssetQ]=useState("");
  const [assetOpen,setAssetOpen]=useState(false);
  const assetRef=useRef(null);
  const filteredAssets=ALL_ASSETS.filter(function(a){return a.toLowerCase().includes(assetQ.toLowerCase())&&!form.mercati.includes(a);});
  useEffect(function(){
    function fn(e){if(assetRef.current&&!assetRef.current.contains(e.target))setAssetOpen(false);}
    document.addEventListener("mousedown",fn);
    return function(){document.removeEventListener("mousedown",fn);};
  },[]);
  function openNew(){setForm(emptyForm());setEditing(null);setAssetQ("");setModal(true);}
  function openEdit(s){setForm({nome:s.nome,stato:s.stato,tf:s.tf,mercati:[...(s.mercati||[])],checklist:{bias:[...(s.checklist?.bias||[])],trigger:[...(s.checklist?.trigger||[])],contesto:[...(s.checklist?.contesto||[])],gestione:[...(s.checklist?.gestione||[])]},note:s.note||""});setEditing(s.id);setAssetQ("");setModal(true);}
  async function save(){
    if(!form.nome.trim()) return;
    if(editing){await db.strategie.update(editing,{...form});}
    else{await db.strategie.add({...form,data:new Date().toLocaleDateString("it-IT")});}
    await reload();setModal(false);
  }
  const [delAlsoTrade,setDelAlsoTrade]=useState(false);
  async function del(id,withTrade){
    if(withTrade) await db.trade.where("strategia_id").equals(id).delete();
    await db.strategie.delete(id);
    await reload();setConfirmDel(null);setDelAlsoTrade(false);
  }
  function addCkItem(cat){setForm({...form,checklist:{...form.checklist,[cat]:[...form.checklist[cat],""]}});}
  function setCkItem(cat,idx,val){const arr=[...form.checklist[cat]];arr[idx]=val;setForm({...form,checklist:{...form.checklist,[cat]:arr}});}
  function removeCkItem(cat,idx){const arr=form.checklist[cat].filter(function(_,i){return i!==idx;});setForm({...form,checklist:{...form.checklist,[cat]:arr}});}
  const statoCol={"Attiva":c.gr,"In pausa":c.am,"Archiviata":c.txm};
  const CK_CATS=[{k:"bias",l:"BIAS"},{k:"trigger",l:"TRIGGER"},{k:"contesto",l:"CONTESTO"},{k:"gestione",l:"GESTIONE"}];
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"12px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:c.sb,flexShrink:0}}>
        <div><div style={{fontSize:15,fontWeight:700,letterSpacing:"-0.02em"}}>Strategie</div><div style={{fontSize:10,color:c.txm}}>{strategie.length} strategie</div></div>
        <button onClick={openNew} style={{padding:"7px 14px",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>+ Nuova Strategia</button>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"16px 20px"}}>
        {strategie.length===0&&<div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Nessuna strategia. Creane una per iniziare!</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
          {strategie.map(function(s){return(
            <div key={s.id} style={{background:c.card,borderRadius:12,padding:"16px",border:"1px solid "+c.bd}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:700,marginBottom:6}}>{s.nome}</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:4}}>
                    {(s.mercati||[]).slice(0,4).map(function(m){return <span key={m} style={{fontSize:9,fontWeight:600,padding:"2px 6px",borderRadius:20,background:c.ac+"15",color:c.ac}}>{m}</span>;})}
                  </div>
                  <span style={{fontSize:9,fontWeight:600,padding:"2px 6px",borderRadius:20,background:c.tag,color:c.txm}}>{s.tf||"—"}</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                  <div style={{padding:"2px 8px",borderRadius:20,background:(statoCol[s.stato]||c.txm)+"15"}}>
                    <span style={{fontSize:9,fontWeight:700,color:statoCol[s.stato]||c.txm}}>{s.stato}</span>
                  </div>
                  <div style={{display:"flex",gap:4}}>
                    <button onClick={function(){openEdit(s);}} style={{padding:"3px 8px",borderRadius:5,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>✏</button>
                    <button onClick={function(){setConfirmDel(s.id);}} style={{padding:"3px 8px",borderRadius:5,border:"1px solid "+c.rd+"40",background:c.rd+"08",color:c.rd,fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
                  </div>
                </div>
              </div>
              <div style={{fontSize:9,color:c.txs,marginTop:4}}>Creata il {s.data||"—"}</div>
            </div>
          );})}
        </div>
      </div>
      {confirmDel&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:c.card,borderRadius:14,padding:"24px",width:380,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:6}}>🗑 Elimina Strategia</div>
            <div style={{fontSize:12,color:c.txm,marginBottom:14}}>Sei sicuro di voler eliminare questa strategia? L'azione non può essere annullata.</div>
            <div onClick={function(){setDelAlsoTrade(function(v){return !v;});}}
              style={{display:"flex",alignItems:"flex-start",gap:10,padding:"12px 14px",borderRadius:10,
                background:delAlsoTrade?c.rd+"10":"transparent",border:"1px solid "+(delAlsoTrade?c.rd+"50":c.bd),
                cursor:"pointer",marginBottom:18,transition:"all 0.15s"}}>
              <div style={{width:18,height:18,borderRadius:4,border:"2px solid "+(delAlsoTrade?c.rd:c.bd),background:delAlsoTrade?c.rd:"transparent",
                display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>
                {delAlsoTrade&&<span style={{color:"#fff",fontSize:11,fontWeight:700}}>✓</span>}
              </div>
              <div>
                <div style={{fontSize:12,fontWeight:600,color:delAlsoTrade?c.rd:c.tx}}>Elimina anche tutti i trade collegati</div>
                <div style={{fontSize:10,color:c.txm,marginTop:2}}>Tutti i trade associati a questa strategia verranno eliminati definitivamente.</div>
              </div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={function(){setConfirmDel(null);setDelAlsoTrade(false);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
              <button onClick={function(){del(confirmDel,delAlsoTrade);}} style={{padding:"8px 18px",borderRadius:8,background:c.rd,border:"none",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                {delAlsoTrade?"Elimina Strategia + Trade":"Elimina Solo Strategia"}
              </button>
            </div>
          </div>
        </div>
      )}
      {modal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){setModal(false);}}>
          <div style={{background:c.card,borderRadius:14,padding:"24px",width:600,maxHeight:"88vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}} onClick={function(e){e.stopPropagation();}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:16,fontWeight:700}}>{editing?"Modifica Strategia":"Nuova Strategia"}</div>
              <button onClick={function(){setModal(false);}} style={{width:28,height:28,borderRadius:7,border:"1px solid "+c.bd,background:c.tag,cursor:"pointer",fontSize:16,color:c.txm,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
              <div style={{gridColumn:"1/3"}}>
                <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>NOME *</div>
                <input value={form.nome} onChange={function(e){setForm({...form,nome:e.target.value});}} placeholder="es. Momentum BOS" style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>STATO</div>
                <select value={form.stato} onChange={function(e){setForm({...form,stato:e.target.value});}} style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                  {["Attiva","In pausa","Archiviata"].map(function(s){return <option key={s}>{s}</option>;})}
                </select>
              </div>
            </div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>TIMEFRAME</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {["M1","M5","M15","M30","H1","H4","D1"].map(function(t){return(
                  <button key={t} onClick={function(){setForm({...form,tf:t});}} style={{padding:"5px 10px",borderRadius:6,border:"1px solid "+(form.tf===t?c.ac:c.bd),background:form.tf===t?c.ac+"12":"transparent",color:form.tf===t?c.ac:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:form.tf===t?700:400}}>{t}</button>
                );})}
              </div>
            </div>
            <div style={{marginBottom:14}} ref={assetRef}>
              <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>ASSET / MERCATI</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
                {form.mercati.map(function(a){return(
                  <div key={a} style={{display:"flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:20,background:c.ac+"15",border:"1px solid "+c.ac+"30"}}>
                    <span style={{fontSize:10,fontWeight:600,color:c.ac}}>{a}</span>
                    <button onClick={function(){setForm({...form,mercati:form.mercati.filter(function(x){return x!==a;})});}} style={{width:12,height:12,borderRadius:"50%",border:"none",background:"transparent",color:c.ac,cursor:"pointer",fontSize:10,lineHeight:1,padding:0}}>×</button>
                  </div>
                );})}
              </div>
              <div style={{position:"relative"}}>
                <input value={assetQ} onChange={function(e){setAssetQ(e.target.value);setAssetOpen(true);}} onFocus={function(){setAssetOpen(true);}} placeholder="Cerca asset..." style={{width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                {assetOpen&&(
                  <div style={{position:"absolute",top:"calc(100% + 3px)",left:0,right:0,zIndex:300,background:c.card,border:"1px solid "+c.bd,borderRadius:8,boxShadow:"0 8px 24px rgba(0,0,0,0.12)",maxHeight:150,overflowY:"auto"}}>
                    {filteredAssets.slice(0,12).map(function(a){return <div key={a} onClick={function(){setForm({...form,mercati:[...form.mercati,a]});setAssetQ("");setAssetOpen(false);}} style={{padding:"6px 12px",cursor:"pointer",fontSize:12,color:c.tx}} onMouseEnter={function(e){e.currentTarget.style.background=c.tag;}} onMouseLeave={function(e){e.currentTarget.style.background="transparent";}}>{a}</div>;})}
                    {assetQ&&!ALL_ASSETS.includes(assetQ.toUpperCase())&&<div onClick={function(){setForm({...form,mercati:[...form.mercati,assetQ.toUpperCase()]});setAssetQ("");setAssetOpen(false);}} style={{padding:"6px 12px",cursor:"pointer",fontSize:11,color:c.ac,borderTop:"1px solid "+c.bd}}>+ Aggiungi "{assetQ.toUpperCase()}"</div>}
                  </div>
                )}
              </div>
            </div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:8}}>CHECKLIST</div>
              <div style={{fontSize:9,color:c.txm,marginBottom:10,padding:"6px 10px",borderRadius:7,background:c.ac+"08",border:"1px solid "+c.ac+"20"}}>Aggiungi i punti che appariranno come checkbox durante l'inserimento trade.</div>
              {CK_CATS.map(function(cat){return(
                <div key={cat.k} style={{marginBottom:12}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{fontSize:10,fontWeight:700,color:c.ac,letterSpacing:"0.06em"}}>{cat.l}</span>
                    <button onClick={function(){addCkItem(cat.k);}} style={{fontSize:10,color:c.ac,background:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>+ Aggiungi</button>
                  </div>
                  {form.checklist[cat.k].length===0&&<div style={{fontSize:10,color:c.txs,padding:"6px 8px",borderRadius:6,background:c.bg,border:"1px dashed "+c.bd}}>Nessun punto.</div>}
                  {form.checklist[cat.k].map(function(item,idx){return(
                    <div key={idx} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                      <span style={{fontSize:10,color:c.txm,flexShrink:0}}>☐</span>
                      <input value={item} onChange={function(e){setCkItem(cat.k,idx,e.target.value);}} placeholder="Descrivi il punto..." style={{flex:1,padding:"6px 9px",borderRadius:6,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none"}}/>
                      <button onClick={function(){removeCkItem(cat.k,idx);}} style={{width:20,height:20,borderRadius:4,border:"1px solid "+c.rd+"40",background:c.rd+"08",color:c.rd,fontSize:10,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>✕</button>
                    </div>
                  );})}
                </div>
              );})}
            </div>
            <div style={{marginBottom:20}}>
              <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>NOTE GENERALI</div>
              <textarea value={form.note} onChange={function(e){setForm({...form,note:e.target.value});}} placeholder="Logica della strategia, quando usarla..." style={{width:"100%",height:80,padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",resize:"vertical",outline:"none",boxSizing:"border-box"}}/>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={function(){setModal(false);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
              <button onClick={save} style={{padding:"8px 20px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Salva</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CONTI ─────────────────────────────────────────────────────────────────────
function Conti({c,conti,strategie,trades,reload}){
  const [modal,setModal]=useState(false);
  const [editing,setEditing]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  const emptyForm=function(){return {nome:"",tipo:"Reale",broker:"",valuta:"EUR",cap_iniz:"",stato:"Attivo",strats:[]};};
  const [form,setForm]=useState(emptyForm());
  function openNew(){setForm(emptyForm());setEditing(null);setModal(true);}
  function openEdit(cn){setForm({nome:cn.nome,tipo:cn.tipo,broker:cn.broker||"",valuta:cn.valuta||"EUR",cap_iniz:cn.cap_iniz,stato:cn.stato,strats:cn.strats||[]});setEditing(cn.id);setModal(true);}
  async function save(){
    if(!form.nome.trim()) return;
    const cap=parseFloat(form.cap_iniz)||0;
    if(editing){await db.conti.update(editing,{...form,cap_iniz:cap});}
    else{await db.conti.add({...form,cap_iniz:cap});}
    await reload();setModal(false);
  }
  const [delAlsoTrade,setDelAlsoTrade]=useState(false);
  async function del(id,withTrade){
    if(withTrade) await db.trade.where("conto_id").equals(id).delete();
    await db.conti.delete(id);
    await reload();setConfirmDel(null);setDelAlsoTrade(false);
  }
  function toggleStrat(id){const s=form.strats.includes(id)?form.strats.filter(function(x){return x!==id;}):[...form.strats,id];setForm({...form,strats:s});}
  const tipoCol={"Reale":c.gr,"Demo":c.bl,"Prop Firm":c.am};
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"12px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:c.sb,flexShrink:0}}>
        <div><div style={{fontSize:15,fontWeight:700,letterSpacing:"-0.02em"}}>Conti</div><div style={{fontSize:10,color:c.txm}}>{conti.length} conti</div></div>
        <button onClick={openNew} style={{padding:"7px 14px",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>+ Nuovo Conto</button>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"16px 20px"}}>
        {conti.length===0&&<div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Nessun conto. Creane uno per iniziare!</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          {conti.map(function(cn){
            const contoTrades=trades.filter(function(t){return t.conto_id===cn.id;});
            const m=calcMetrics(contoTrades);
            const pnl_r=m.totalR;
            const stratNames=strategie.filter(function(s){return (cn.strats||[]).includes(s.id);}).map(function(s){return s.nome;});
            return(
              <div key={cn.id} style={{background:c.card,borderRadius:12,padding:"16px",border:"1px solid "+c.bd}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                  <div>
                    <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>{cn.nome}</div>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:20,background:(tipoCol[cn.tipo]||c.txm)+"15",color:tipoCol[cn.tipo]||c.txm}}>{cn.tipo}</span>
                      <span style={{fontSize:10,color:c.txm}}>{cn.broker||"—"} · {cn.valuta||"EUR"}</span>
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:18,fontWeight:700,color:c.tx}}>{cn.valuta||"$"}{(cn.cap_iniz||0).toLocaleString()}</div>
                    <div style={{fontSize:11,color:pnl_r>=0?c.gr:c.rd,fontWeight:600}}>{fmtR(pnl_r)}</div>
                  </div>
                </div>
                <div style={{height:1,background:c.bd,marginBottom:10}}/>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:10}}>
                  {[{l:"Trade",v:contoTrades.length},{l:"Win Rate",v:m.wr+"%"},{l:"Profit Factor",v:m.pf}].map(function(mm,i){return(
                    <div key={i} style={{background:c.bg,borderRadius:7,padding:"8px 10px"}}>
                      <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:2}}>{mm.l}</div>
                      <div style={{fontSize:12,fontWeight:700,color:c.tx}}>{mm.v}</div>
                    </div>
                  );})}
                </div>
                {stratNames.length>0&&(
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:4}}>STRATEGIE</div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                      {stratNames.map(function(sn){return <span key={sn} style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:c.ac+"12",color:c.ac}}>{sn}</span>;})}
                    </div>
                  </div>
                )}
                <div style={{display:"flex",gap:7}}>
                  <button onClick={function(){openEdit(cn);}} style={{flex:1,padding:"6px",borderRadius:7,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>✏ Modifica</button>
                  <button onClick={function(){setConfirmDel(cn.id);}} style={{padding:"6px 12px",borderRadius:7,border:"1px solid "+c.rd+"40",background:c.rd+"08",color:c.rd,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Elimina</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {confirmDel&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:c.card,borderRadius:12,padding:"24px",width:320,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:6}}>🗑 Elimina Conto</div>
            <div style={{fontSize:12,color:c.txm,marginBottom:14}}>Sei sicuro di voler eliminare questo conto? L'azione non può essere annullata.</div>
            <div onClick={function(){setDelAlsoTrade(function(v){return !v;});}}
              style={{display:"flex",alignItems:"flex-start",gap:10,padding:"12px 14px",borderRadius:10,
                background:delAlsoTrade?c.rd+"10":"transparent",border:"1px solid "+(delAlsoTrade?c.rd+"50":c.bd),
                cursor:"pointer",marginBottom:18,transition:"all 0.15s"}}>
              <div style={{width:18,height:18,borderRadius:4,border:"2px solid "+(delAlsoTrade?c.rd:c.bd),background:delAlsoTrade?c.rd:"transparent",
                display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>
                {delAlsoTrade&&<span style={{color:"#fff",fontSize:11,fontWeight:700}}>✓</span>}
              </div>
              <div>
                <div style={{fontSize:12,fontWeight:600,color:delAlsoTrade?c.rd:c.tx}}>Elimina anche tutti i trade collegati</div>
                <div style={{fontSize:10,color:c.txm,marginTop:2}}>Tutti i trade registrati su questo conto verranno eliminati definitivamente.</div>
              </div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={function(){setConfirmDel(null);setDelAlsoTrade(false);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
              <button onClick={function(){del(confirmDel,delAlsoTrade);}} style={{padding:"8px 18px",borderRadius:8,background:c.rd,border:"none",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                {delAlsoTrade?"Elimina Conto + Trade":"Elimina Solo Conto"}
              </button>
            </div>
          </div>
        </div>
      )}
      {modal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){setModal(false);}}>
          <div style={{background:c.card,borderRadius:14,padding:"24px",width:480,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}} onClick={function(e){e.stopPropagation();}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:16,fontWeight:700}}>{editing?"Modifica Conto":"Nuovo Conto"}</div>
              <button onClick={function(){setModal(false);}} style={{width:28,height:28,borderRadius:7,border:"1px solid "+c.bd,background:c.tag,cursor:"pointer",fontSize:16,color:c.txm,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div style={{gridColumn:"1/-1"}}><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>NOME *</div><input value={form.nome} onChange={function(e){setForm({...form,nome:e.target.value});}} placeholder="es. Live EUR" style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
              <div><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>TIPO</div><select value={form.tipo} onChange={function(e){setForm({...form,tipo:e.target.value});}} style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>{["Reale","Demo","Prop Firm"].map(function(t){return <option key={t}>{t}</option>;})}</select></div>
              <div><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>VALUTA</div><input value={form.valuta} onChange={function(e){setForm({...form,valuta:e.target.value});}} placeholder="EUR" style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
              <div><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>BROKER</div><input value={form.broker} onChange={function(e){setForm({...form,broker:e.target.value});}} placeholder="es. IC Markets" style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
              <div><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>CAPITALE INIZIALE</div><input value={form.cap_iniz} onChange={function(e){setForm({...form,cap_iniz:e.target.value});}} placeholder="es. 10000" type="number" style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
              <div><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>STATO</div><select value={form.stato} onChange={function(e){setForm({...form,stato:e.target.value});}} style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>{["Attivo","Chiuso","Archiviato"].map(function(s){return <option key={s}>{s}</option>;})}</select></div>
            </div>
            {strategie.length>0&&(
              <div style={{marginBottom:16}}>
                <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:8}}>STRATEGIE ASSOCIATE</div>
                {strategie.map(function(s){const sel=form.strats.includes(s.id);return(
                  <div key={s.id} onClick={function(){toggleStrat(s.id);}} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:8,cursor:"pointer",background:sel?c.ac+"10":"transparent",border:"1px solid "+(sel?c.ac+"40":c.bd),marginBottom:5}}>
                    <div style={{width:16,height:16,borderRadius:3,border:"2px solid "+(sel?c.ac:c.bd),background:sel?c.ac:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{sel&&<span style={{color:"#fff",fontSize:10,fontWeight:700}}>✓</span>}</div>
                    <span style={{fontSize:12,fontWeight:sel?600:400,color:sel?c.ac:c.tx}}>{s.nome}</span>
                  </div>
                );})}
              </div>
            )}
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={function(){setModal(false);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
              <button onClick={save} style={{padding:"8px 20px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Salva</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



// ── MODAL SYSTEM ─────────────────────────────────────────────────────────────
// Confirm dialog — replaces window.confirm
function ConfirmModal({c, title, message, onConfirm, onCancel, danger}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(3px)"}}
      onClick={onCancel}>
      <div style={{background:c.card,borderRadius:14,padding:24,width:340,boxShadow:"0 20px 60px rgba(0,0,0,0.35)"}}
        onClick={function(e){e.stopPropagation();}}>
        <div style={{fontSize:15,fontWeight:800,marginBottom:8,letterSpacing:"-0.02em"}}>{title||"Conferma"}</div>
        <div style={{fontSize:12,color:c.txm,marginBottom:20,lineHeight:1.6}}>{message}</div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={onCancel} style={{padding:"8px 18px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
          <button onClick={onConfirm} style={{padding:"8px 18px",borderRadius:8,border:"none",background:danger?c.rd:"linear-gradient(135deg,#4F46E5,#7C3AED)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{danger?"Elimina":"Conferma"}</button>
        </div>
      </div>
    </div>
  );
}

// Alert dialog — replaces window.alert
function AlertModal({c, title, message, onClose, type}){
  const icons = {error:"❌",warning:"⚠️",success:"✅",info:"ℹ️"};
  const colors = {error:c.rd,warning:c.am,success:c.gr,info:c.ac};
  const t = type||"info";
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(3px)"}}
      onClick={onClose}>
      <div style={{background:c.card,borderRadius:14,padding:24,width:380,boxShadow:"0 20px 60px rgba(0,0,0,0.35)"}}
        onClick={function(e){e.stopPropagation();}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
          <span style={{fontSize:20}}>{icons[t]}</span>
          <div style={{fontSize:14,fontWeight:800,letterSpacing:"-0.02em",color:colors[t]}}>{title||"Attenzione"}</div>
        </div>
        <div style={{fontSize:12,color:c.txm,marginBottom:20,lineHeight:1.7,whiteSpace:"pre-line"}}>{message}</div>
        <div style={{display:"flex",justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{padding:"8px 24px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>OK</button>
        </div>
      </div>
    </div>
  );
}

// Hook to use modals easily
function useModal(){
  const [modal,setModal]=useState(null);
  function showConfirm(title,message,onConfirm,danger){
    setModal({type:"confirm",title,message,onConfirm,danger});
  }
  function showAlert(title,message,type){
    setModal({type:"alert",title,message,alertType:type||"info"});
  }
  function closeModal(){setModal(null);}
  function ModalRenderer({c}){
    if(!modal) return null;
    if(modal.type==="confirm") return <ConfirmModal c={c} title={modal.title} message={modal.message} danger={modal.danger} onConfirm={function(){modal.onConfirm();closeModal();}} onCancel={closeModal}/>;
    if(modal.type==="alert") return <AlertModal c={c} title={modal.title} message={modal.message} type={modal.alertType} onClose={closeModal}/>;
    return null;
  }
  return {showConfirm,showAlert,closeModal,ModalRenderer};
}

// ── CUSTOM DATE PICKER ────────────────────────────────────────────────────────
function DatePicker({value, onChange, label, c, syncDateFrom}){
  const pad = function(x){ return String(x).padStart(2,"0"); };
  const today = new Date();

  function parseDateStr(v){
    const d = v ? new Date(v) : today;
    return {
      y: d.getFullYear(),
      mo: d.getMonth(),
      d: d.getDate(),
      h: d.getHours(),
      mi: d.getMinutes(),
    };
  }

  const init = parseDateStr(value);
  const [calYear, setCalYear] = useState(init.y);
  const [calMonth, setCalMonth] = useState(init.mo);
  const [dateStr, setDateStr] = useState(
    init.y+"-"+pad(init.mo+1)+"-"+pad(init.d)
  );
  const [timeRaw, setTimeRaw] = useState(pad(init.h)+pad(init.mi));
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("days"); // "days" | "months" | "years"
  const [yearBase, setYearBase] = useState(Math.floor(init.y/12)*12);
  const ref = useRef(null);

  function parseTime(raw){
    const digits = (raw||"").replace(/\D/g,"").slice(0,4);
    if(!digits.length) return "00:00";
    if(digits.length<=2) return digits.padStart(2,"0")+":00";
    const hh = Math.min(parseInt(digits.slice(0,2))||0,23);
    const mm = Math.min(parseInt(digits.slice(2,4).padEnd(2,"0"))||0,59);
    return pad(hh)+":"+pad(mm);
  }

  function commit(dStr, tRaw){
    onChange(dStr+"T"+parseTime(tRaw));
  }

  useEffect(function(){
    if(syncDateFrom){
      const d = new Date(syncDateFrom);
      if(!isNaN(d)){
        const nd = d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
        const nt = pad(d.getHours())+pad(d.getMinutes());
        setDateStr(nd); setTimeRaw(nt);
        setCalYear(d.getFullYear()); setCalMonth(d.getMonth());
        commit(nd, nt);
      }
    }
  },[syncDateFrom]);

  useEffect(function(){
    if(value){
      const d = new Date(value);
      if(!isNaN(d)){
        setDateStr(d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()));
        setCalYear(d.getFullYear()); setCalMonth(d.getMonth());
      }
    }
  },[value]);

  useEffect(function(){
    function fn(e){ if(ref.current&&!ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown",fn);
    return function(){ document.removeEventListener("mousedown",fn); };
  },[]);

  const MESI_S = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
  const GIORNI = ["lu","ma","me","gi","ve","sa","do"];
  function daysInMonth(y,m){ return new Date(y,m+1,0).getDate(); }
  function firstDayOfMonth(y,m){ let d=new Date(y,m,1).getDay(); return d===0?6:d-1; }

  const dateParts = dateStr.split("-");
  const displayDate = dateParts.length===3 ? dateParts[2]+"/"+dateParts[1]+"/"+dateParts[0] : dateStr;
  const timeDisplay = parseTime(timeRaw);

  const navBtn = {background:c.tag,border:"none",cursor:"pointer",color:c.tx,fontWeight:700,fontSize:14,
    width:26,height:26,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:6,fontFamily:"inherit"};
  const headerBtn = {background:"transparent",border:"none",cursor:"pointer",color:c.tx,fontWeight:700,
    fontSize:12,fontFamily:"inherit",padding:"2px 6px",borderRadius:5};

  return(
    <div style={{userSelect:"none"}}>
      {label&&<div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.05em"}}>{label}</div>}
      <div style={{display:"flex",gap:6,alignItems:"stretch"}}>
        {/* Date button */}
        <div ref={ref} style={{position:"relative",flex:1}}>
          <button onClick={function(){setOpen(function(o){return !o;});setView("days");}}
            style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+c.inpb,
              background:c.inp,color:c.tx,fontSize:12,cursor:"pointer",fontFamily:"inherit",
              display:"flex",alignItems:"center",gap:6}}>
            <span>📅 {displayDate}</span>
          </button>

          {open&&(
            <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,zIndex:9999,
              background:c.card,border:"1px solid "+c.bd,borderRadius:12,
              boxShadow:"0 12px 40px rgba(0,0,0,0.22)",padding:12,minWidth:230}}>

              {/* ── VISTA ANNI ── */}
              {view==="years"&&(
                <div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                    <button style={navBtn} onClick={function(){setYearBase(function(b){return b-12;});}}>‹</button>
                    <span style={{fontSize:11,fontWeight:700,color:c.txm}}>{yearBase}–{yearBase+11}</span>
                    <button style={navBtn} onClick={function(){setYearBase(function(b){return b+12;});}}>›</button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4}}>
                    {Array.from({length:12},function(_,i){
                      const y=yearBase+i;
                      const isSel=y===calYear;
                      return(
                        <button key={y} onClick={function(){setCalYear(y);setView("months");}}
                          style={{padding:"6px 0",borderRadius:7,border:"1px solid "+(isSel?c.ac:"transparent"),
                            background:isSel?c.ac:"transparent",color:isSel?"#fff":y===today.getFullYear()?c.ac:c.tx,
                            fontSize:11,fontWeight:isSel?700:400,cursor:"pointer",fontFamily:"inherit",textAlign:"center"}}>
                          {y}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── VISTA MESI ── */}
              {view==="months"&&(
                <div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                    <button style={navBtn} onClick={function(){setCalYear(function(y){return y-1;});}}>‹</button>
                    <button style={headerBtn} onClick={function(){setView("years");}}>{calYear}</button>
                    <button style={navBtn} onClick={function(){setCalYear(function(y){return y+1;});}}>›</button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4}}>
                    {MESI_S.map(function(m,i){
                      const isSel=i===calMonth&&calYear===parseInt(dateParts[0]);
                      const isCur=i===today.getMonth()&&calYear===today.getFullYear();
                      return(
                        <button key={i} onClick={function(){setCalMonth(i);setView("days");}}
                          style={{padding:"8px 0",borderRadius:7,border:"1px solid "+(isSel?c.ac:isCur?c.ac+"40":"transparent"),
                            background:isSel?c.ac:"transparent",color:isSel?"#fff":isCur?c.ac:c.tx,
                            fontSize:11,fontWeight:isSel?700:400,cursor:"pointer",fontFamily:"inherit",textAlign:"center"}}>
                          {m}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── VISTA GIORNI ── */}
              {view==="days"&&(
                <div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                    <button style={navBtn} onClick={function(){setCalMonth(function(m){if(m===0){setCalYear(function(y){return y-1;});return 11;}return m-1;});}}>‹</button>
                    <div style={{display:"flex",gap:4,alignItems:"center"}}>
                      <button style={headerBtn} onClick={function(){setView("months");}}>{MESI_S[calMonth]}</button>
                      <button style={headerBtn} onClick={function(){setView("years");}}>{calYear}</button>
                    </div>
                    <button style={navBtn} onClick={function(){setCalMonth(function(m){if(m===11){setCalYear(function(y){return y+1;});return 0;}return m+1;});}}>›</button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
                    {GIORNI.map(function(g){return <div key={g} style={{textAlign:"center",fontSize:9,color:c.txs,fontWeight:600,padding:"2px 0"}}>{g}</div>;})}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
                    {Array.from({length:firstDayOfMonth(calYear,calMonth)},function(_,i){return <div key={"e"+i}/>;})}
                    {Array.from({length:daysInMonth(calYear,calMonth)},function(_,i){
                      const d=i+1;
                      const newDate=calYear+"-"+pad(calMonth+1)+"-"+pad(d);
                      const isSel=newDate===dateStr;
                      const isToday=d===today.getDate()&&calMonth===today.getMonth()&&calYear===today.getFullYear();
                      return(
                        <button key={d} onClick={function(){setDateStr(newDate);commit(newDate,timeRaw);setOpen(false);setView("days");}}
                          style={{padding:"5px 0",borderRadius:6,
                            border:"1px solid "+(isSel?c.ac:isToday?c.ac+"40":"transparent"),
                            background:isSel?c.ac:"transparent",
                            color:isSel?"#fff":isToday?c.ac:c.tx,
                            fontSize:11,fontWeight:isSel?700:400,cursor:"pointer",fontFamily:"inherit",textAlign:"center"}}>
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>

        {/* Time smart input */}
        <div style={{display:"flex",flexDirection:"column",gap:2}}>
          <div style={{fontSize:9,fontWeight:600,color:c.txm,textAlign:"center"}}>ORA</div>
          <input
            value={timeRaw}
            onChange={function(e){
              const raw=e.target.value.replace(/\D/g,"").slice(0,4);
              setTimeRaw(raw);
              commit(dateStr,raw);
            }}
            onBlur={function(){
              const t=parseTime(timeRaw);
              const [h,m]=t.split(":");
              setTimeRaw(h+m);
              commit(dateStr,timeRaw);
            }}
            placeholder="0930"
            maxLength={4}
            style={{width:60,padding:"8px 6px",borderRadius:7,border:"1px solid "+c.inpb,
              background:c.inp,color:c.tx,fontSize:13,fontWeight:700,fontFamily:"inherit",
              outline:"none",textAlign:"center",boxSizing:"border-box"}}
          />
          <div style={{fontSize:9,color:c.ac,textAlign:"center",fontWeight:700}}>{timeDisplay}</div>
        </div>
      </div>
    </div>
  );
}

// ── CSV IMPORT ────────────────────────────────────────────────────────────────
function ImportCSV({c, conti, strategie, reload, onClose}){
  const [step, setStep] = useState("upload"); // upload | preview | importing | done
  const [platform, setPlatform] = useState(null); // "ctrader"|"mt4"|"mt5"|"manual"
  const [rawRows, setRawRows] = useState([]);
  const [parsed, setParsed] = useState([]);
  const [errors, setErrors] = useState([]);
  const [selConto, setSelConto] = useState(conti[0]?.id||"");
  const [selStrat, setSelStrat] = useState("");
  const [importCount, setImportCount] = useState(0);
  const [progress, setProgress] = useState(0);

  // ── Parse cTrader CSV ──
  function parseCTrader(text){
    const lines = text.replace(/\r/g,"").split("\n");
    const results = [];
    const errs = [];
    let inOp = false;
    for(let i=0;i<lines.length;i++){
      const line = lines[i].trim();
      if(line === "Operazioni"){ inOp=true; continue; }
      if(inOp && line.startsWith("Simbolo,")){ continue; } // header row
      // Stop at next section
      if(inOp && (line===""||line==="Posizioni"||line==="Transazioni"||line==="Riepilogo"||line==="Saldo")){
        if(line!=="") inOp=false;
        continue;
      }
      if(!inOp) continue;
      // Parse data row
      // Format: Simbolo,Direzione,Orario chiusura,Entry,Exit,Size,NettoUSD,SaldoUSD
      const cols = line.split(",");
      if(cols.length < 7) continue;
      const symbol = cols[0].replace(".p","").replace(".m","").trim();
      const dirRaw = cols[1].trim().toLowerCase();
      const dir = dirRaw==="acquista"||dirRaw==="buy" ? "L" : "S";
      const closeTimeRaw = cols[2].trim();
      const entry = parseFloat(cols[3]);
      const exit_ = parseFloat(cols[4]);
      const sizeRaw = cols[5].trim(); // "0.3 Lotti" or "1 Lotti"
      const size = parseFloat(sizeRaw);
      const pnl = parseFloat(cols[6].replace(/\s/g,""));
      if(isNaN(entry)||isNaN(exit_)||isNaN(size)) continue;
      // Parse date: "18 Giu 2025 09:16:04.926"
      const MMAP = {Gen:0,Feb:1,Mar:2,Apr:3,Mag:4,Giu:5,Lug:6,Ago:7,Set:8,Ott:9,Nov:10,Dic:11};
      let closeDate = new Date();
      try{
        const dp = closeTimeRaw.split(" ");
        if(dp.length>=4){
          const day=parseInt(dp[0]);
          const mon=MMAP[dp[1]]??0;
          const yr=parseInt(dp[2]);
          const timeParts=(dp[3]||"00:00:00").split(":");
          closeDate=new Date(yr,mon,day,parseInt(timeParts[0]),parseInt(timeParts[1]),0);
        }
      } catch(e){}
      // Estimate open time = close - 1 hour (cTrader only exports close time)
      const openDate = new Date(closeDate.getTime() - 60*60*1000);
      const r = (() => {
        // Can't calculate R without SL — will be 0, user can add SL later
        return 0;
      })();
      results.push({
        _src:"ctrader",
        asset: symbol,
        direzione: dir,
        data_apertura: openDate.toISOString().slice(0,16),
        data_chiusura: closeDate.toISOString().slice(0,16),
        entry, exit: exit_, sl: null, tp: null,
        size, pnl_eur: pnl,
        r_result: 0,
        note_tec: "Importato da cTrader",
        mae: null, mfe: null,
        commissioni: 0,
        mood:"", sc_esecuzione:null, sc_complessivo:null,
        tags:[], checklist:{}, parziali:[],
      });
    }
    return {results, errs};
  }

  // ── Parse MT4 CSV ──
  function parseMT4(text){
    const lines = text.replace(/\r/g,"").split("\n");
    const results = [];
    const errs = [];
    // Find header row
    let headerIdx = -1;
    for(let i=0;i<lines.length;i++){
      const l = lines[i].toLowerCase();
      if(l.includes("ticket")&&l.includes("type")&&l.includes("profit")){
        headerIdx=i; break;
      }
    }
    if(headerIdx<0){ return {results,errs:["Header MT4 non trovato. Verifica il formato del file."]}; }
    const headers = lines[headerIdx].split(",").map(function(h){return h.trim().toLowerCase();});
    const idx = function(k){ return headers.findIndex(function(h){return h.includes(k);}); };
    const iTicket=idx("ticket"), iOpenTime=idx("open time"), iType=idx("type");
    const iSize=idx("size"), iItem=idx("item")||idx("symbol"), iPrice=idx("price");
    const iSL=idx("s/l")||idx("sl"), iTP=idx("t/p")||idx("tp");
    const iCloseTime=idx("close time"), iClosePrice=headers.lastIndexOf(headers.find(function(h){return h==="price";})||"price");
    const iProfit=idx("profit");
    for(let i=headerIdx+1;i<lines.length;i++){
      const cols = lines[i].split(",").map(function(v){return v.trim();});
      if(cols.length<8) continue;
      const type = (cols[iType]||"").toLowerCase();
      if(type!=="buy"&&type!=="sell") continue;
      const entry = parseFloat(cols[iPrice]);
      const exit_ = parseFloat(cols[iClosePrice]||cols[iPrice+1]||"0");
      const sl = parseFloat(cols[iSL])||null;
      const tp = parseFloat(cols[iTP])||null;
      const size = parseFloat(cols[iSize])||0;
      const pnl = parseFloat(cols[iProfit])||0;
      const symbol = (cols[iItem]||"").replace(".p","").replace(".m","").toUpperCase();
      const dir = type==="buy"?"L":"S";
      if(isNaN(entry)) continue;
      const parseDate = function(s){
        // Format: "2024.01.15 10:30" or "2024-01-15 10:30"
        try{
          const clean = s.replace(/\./g,"-").replace(" ","T");
          return new Date(clean).toISOString().slice(0,16);
        } catch(e){ return new Date().toISOString().slice(0,16); }
      };
      results.push({
        _src:"mt4",
        asset: symbol,
        direzione: dir,
        data_apertura: parseDate(cols[iOpenTime]||""),
        data_chiusura: parseDate(cols[iCloseTime]||""),
        entry, exit: exit_, sl, tp, size, pnl_eur: pnl,
        r_result: 0, note_tec:"Importato da MT4",
        mae:null, mfe:null, commissioni:0,
        mood:"", sc_esecuzione:null, sc_complessivo:null,
        tags:[], checklist:{}, parziali:[],
      });
    }
    return {results, errs};
  }

  // ── Parse MT5 CSV ──
  function parseMT5(text){
    const lines = text.replace(/\r/g,"").split("\n");
    const results = [];
    const errs = [];
    let headerIdx = -1;
    for(let i=0;i<lines.length;i++){
      const l = lines[i].toLowerCase();
      if((l.includes("position")||l.includes("deal"))&&l.includes("symbol")&&l.includes("profit")){
        headerIdx=i; break;
      }
    }
    if(headerIdx<0){ return {results,errs:["Header MT5 non trovato. Verifica il formato del file."]}; }
    const headers = lines[headerIdx].split(",").map(function(h){return h.trim().toLowerCase().replace(/ /g,"");});
    const idx = function(k){ return headers.findIndex(function(h){return h.includes(k);}); };
    const iTime=idx("time"), iSymbol=idx("symbol"), iType=idx("type")||idx("direction");
    const iVolume=idx("volume"), iPrice=idx("price"), iSL=idx("s/l")||idx("sl");
    const iTP=idx("t/p")||idx("tp"), iProfit=idx("profit");
    for(let i=headerIdx+1;i<lines.length;i++){
      const cols = lines[i].split(",").map(function(v){return v.trim();});
      if(cols.length<6) continue;
      const type=(cols[iType]||"").toLowerCase();
      if(!type.includes("buy")&&!type.includes("sell")) continue;
      const entry=parseFloat(cols[iPrice]);
      const sl=parseFloat(cols[iSL])||null;
      const tp=parseFloat(cols[iTP])||null;
      const size=parseFloat(cols[iVolume])||0;
      const pnl=parseFloat(cols[iProfit])||0;
      const symbol=(cols[iSymbol]||"").replace(".p","").toUpperCase();
      const dir=type.includes("buy")?"L":"S";
      if(isNaN(entry)) continue;
      const parseDate=function(s){
        try{ return new Date(s.replace(/\./g,"-").replace(" ","T")).toISOString().slice(0,16); }
        catch(e){ return new Date().toISOString().slice(0,16); }
      };
      results.push({
        _src:"mt5",
        asset:symbol, direzione:dir,
        data_apertura:parseDate(cols[iTime]||""),
        data_chiusura:parseDate(cols[iTime]||""),
        entry, exit:entry, sl, tp, size, pnl_eur:pnl,
        r_result:0, note_tec:"Importato da MT5",
        mae:null, mfe:null, commissioni:0,
        mood:"", sc_esecuzione:null, sc_complessivo:null,
        tags:[], checklist:{}, parziali:[],
      });
    }
    return {results,errs};
  }

  // ── Auto-detect platform ──
  function detectPlatform(text){
    if(text.includes("Operazioni")&&(text.includes("Acquista")||text.includes("Vendi"))) return "ctrader";
    if(text.toLowerCase().includes("ticket")&&text.toLowerCase().includes("open time")) return "mt4";
    if(text.toLowerCase().includes("position")&&text.toLowerCase().includes("symbol")&&text.toLowerCase().includes("volume")) return "mt5";
    return "unknown";
  }

  function handleFile(e){
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = function(ev){
      const text = ev.target.result;
      const plat = detectPlatform(text);
      setPlatform(plat);
      let res;
      if(plat==="ctrader") res=parseCTrader(text);
      else if(plat==="mt4") res=parseMT4(text);
      else if(plat==="mt5") res=parseMT5(text);
      else { setErrors(["Formato non riconosciuto. Supportiamo cTrader, MT4 e MT5."]); return; }
      setParsed(res.results);
      setErrors(res.errs);
      setRawRows(res.results);
      setStep("preview");
    };
    reader.readAsText(file, "utf-8");
  }

  async function doImport(){
    if(!selConto){ return; } // button disabled when no conto selected
    setStep("importing");
    let count=0;
    for(let i=0;i<parsed.length;i++){
      const t=parsed[i];
      const td={
        conto_id:parseInt(selConto),
        strategia_id:selStrat?parseInt(selStrat):null,
        asset:t.asset,
        direzione:t.direzione,
        data_apertura:t.data_apertura?new Date(t.data_apertura).toISOString():new Date().toISOString(),
        data_chiusura:t.data_chiusura?new Date(t.data_chiusura).toISOString():new Date().toISOString(),
        entry:t.entry||0,
        exit:t.exit||0,
        sl:t.sl||null,
        tp:t.tp||null,
        size:t.size||null,
        mae:null, mfe:null,
        commissioni:t.commissioni||0,
        pnl_eur:t.pnl_eur||null,
        r_result:0,
        note_tec:t.note_tec||"",
        note_psi:"", mood:"",
        sc_esecuzione:null, sc_complessivo:null,
        tags:[], checklist:{}, parziali:[],
        screenshot_url:"",
        created_at:new Date().toISOString(),
        draft:false,
      };
      await db.trade.add(td);
      count++;
      setProgress(Math.round((i+1)/parsed.length*100));
    }
    setImportCount(count);
    await reload();
    setStep("done");
  }

  const platLabel = {ctrader:"cTrader",mt4:"MetaTrader 4",mt5:"MetaTrader 5",unknown:"Sconosciuto"};
  const platColor = {ctrader:"#0F766E",mt4:"#1D4ED8",mt5:"#7C3AED",unknown:c.txm};

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)"}}>
      <div style={{background:c.card,borderRadius:16,padding:28,width:580,maxHeight:"85vh",overflow:"auto",boxShadow:"0 24px 80px rgba(0,0,0,0.4)"}}>

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
          <div>
            <div style={{fontSize:16,fontWeight:800,letterSpacing:"-0.02em"}}>📥 Import Trade da CSV</div>
            <div style={{fontSize:11,color:c.txm,marginTop:2}}>Supporta cTrader · MT4 · MT5</div>
          </div>
          <button onClick={onClose} style={{background:"transparent",border:"none",color:c.txm,fontSize:18,cursor:"pointer"}}>✕</button>
        </div>

        {/* STEP: Upload */}
        {step==="upload"&&(
          <div>
            <div style={{border:"2px dashed "+c.bd,borderRadius:12,padding:40,textAlign:"center",marginBottom:16,cursor:"pointer",transition:"border-color 0.2s"}}
              onDragOver={function(e){e.preventDefault();e.currentTarget.style.borderColor=c.ac;}}
              onDragLeave={function(e){e.currentTarget.style.borderColor=c.bd;}}
              onDrop={function(e){e.preventDefault();e.currentTarget.style.borderColor=c.bd;const f=e.dataTransfer.files[0];if(f){const inp=document.getElementById("csv-input");const dt=new DataTransfer();dt.items.add(f);inp.files=dt.files;handleFile({target:{files:[f]}})};}}>
              <div style={{fontSize:32,marginBottom:8}}>📂</div>
              <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>Trascina il CSV qui</div>
              <div style={{fontSize:11,color:c.txm,marginBottom:12}}>oppure clicca per selezionare il file</div>
              <label style={{padding:"8px 20px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                Seleziona file
                <input id="csv-input" type="file" accept=".csv,.txt" style={{display:"none"}} onChange={handleFile}/>
              </label>
            </div>
            {errors.length>0&&(
              <div style={{background:c.rd+"10",border:"1px solid "+c.rd+"30",borderRadius:8,padding:12,fontSize:11,color:c.rd}}>
                {errors.map(function(e,i){return <div key={i}>⚠ {e}</div>;})}
              </div>
            )}
            <div style={{marginTop:16,padding:12,background:c.tag,borderRadius:8,fontSize:11,color:c.txm,lineHeight:1.6}}>
              <div style={{fontWeight:700,marginBottom:4,color:c.tx}}>Come esportare:</div>
              <div><strong>cTrader:</strong> Storico → icona Esporta → Esporta CSV</div>
              <div><strong>MT4:</strong> Terminale → Storico → tasto destro → Salva come Report dettagliato</div>
              <div><strong>MT5:</strong> Terminale → Storico → tasto destro → Esporta in CSV</div>
            </div>
          </div>
        )}

        {/* STEP: Preview */}
        {step==="preview"&&(
          <div>
            {/* Platform badge */}
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
              <div style={{padding:"4px 12px",borderRadius:20,background:(platColor[platform]||c.ac)+"15",color:platColor[platform]||c.ac,fontSize:11,fontWeight:700,border:"1px solid "+(platColor[platform]||c.ac)+"30"}}>
                ✓ {platLabel[platform]||"Formato rilevato"}
              </div>
              <div style={{fontSize:11,color:c.txm}}>{parsed.length} trade trovati</div>
            </div>

            {/* Conto e Strategia */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              <div>
                <div style={{fontSize:10,fontWeight:700,color:c.txm,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Conto destinazione *</div>
                <select value={selConto} onChange={function(e){setSelConto(e.target.value);}}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none"}}>
                  <option value="">Seleziona conto...</option>
                  {conti.map(function(cn){return <option key={cn.id} value={cn.id}>{cn.nome}</option>;})}
                </select>
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:700,color:c.txm,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Strategia (opz.)</div>
                <select value={selStrat} onChange={function(e){setSelStrat(e.target.value);}}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none"}}>
                  <option value="">Nessuna strategia</option>
                  {strategie.map(function(s){return <option key={s.id} value={s.id}>{s.nome}</option>;})}
                </select>
              </div>
            </div>

            {/* Avviso MAE/MFE */}
            <div style={{background:c.am+"10",border:"1px solid "+c.am+"30",borderRadius:8,padding:10,fontSize:11,color:c.am,marginBottom:14,lineHeight:1.5}}>
              ⚠ <strong>MAE e MFE non sono presenti nel CSV</strong> — dopo l'import potrai aggiungere questi dati aprendo ogni trade dal Journal.
            </div>

            {/* Preview table */}
            <div style={{border:"1px solid "+c.bd,borderRadius:10,overflow:"hidden",marginBottom:16}}>
              <div style={{display:"grid",gridTemplateColumns:"80px 60px 100px 80px 80px 80px",background:c.tag,padding:"7px 12px",gap:0}}>
                {["Asset","Dir","Data chiusura","Entry","Exit","P&L"].map(function(h){return(
                  <div key={h} style={{fontSize:9,fontWeight:700,color:c.txm,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</div>
                );})}
              </div>
              <div style={{maxHeight:220,overflowY:"auto"}}>
                {parsed.slice(0,100).map(function(t,i){return(
                  <div key={i} style={{display:"grid",gridTemplateColumns:"80px 60px 100px 80px 80px 80px",padding:"7px 12px",borderTop:"1px solid "+c.bdl,gap:0,alignItems:"center"}}>
                    <div style={{fontSize:11,fontWeight:600}}>{t.asset}</div>
                    <div><span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:t.direzione==="L"?c.gr+"18":c.rd+"18",color:t.direzione==="L"?c.gr:c.rd,fontWeight:700}}>{t.direzione==="L"?"▲L":"▼S"}</span></div>
                    <div style={{fontSize:10,color:c.txm}}>{t.data_chiusura?.slice(0,16)||"—"}</div>
                    <div style={{fontSize:11}}>{t.entry}</div>
                    <div style={{fontSize:11}}>{t.exit}</div>
                    <div style={{fontSize:11,fontWeight:600,color:t.pnl_eur>=0?c.gr:c.rd}}>{t.pnl_eur>=0?"+":""}{(t.pnl_eur||0).toFixed(2)}</div>
                  </div>
                );})}
                {parsed.length>100&&(
                  <div style={{padding:"8px 12px",textAlign:"center",fontSize:11,color:c.txm}}>... e altri {parsed.length-100} trade</div>
                )}
              </div>
            </div>

            {errors.length>0&&(
              <div style={{background:c.am+"10",border:"1px solid "+c.am+"30",borderRadius:8,padding:10,fontSize:11,color:c.am,marginBottom:12}}>
                {errors.map(function(e,i){return <div key={i}>⚠ {e}</div>;})}
              </div>
            )}

            <div style={{display:"flex",gap:8}}>
              <button onClick={function(){setStep("upload");setParsed([]);setErrors([]);}}
                style={{flex:1,padding:"9px 0",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                ← Indietro
              </button>
              <button onClick={doImport} disabled={!selConto}
                style={{flex:2,padding:"9px 0",borderRadius:8,border:"none",background:selConto?"linear-gradient(135deg,#4F46E5,#7C3AED)":"#6366F150",color:"#fff",fontSize:12,fontWeight:700,cursor:selConto?"pointer":"not-allowed",fontFamily:"inherit"}}>
                📥 Importa {parsed.length} Trade
              </button>
            </div>
          </div>
        )}

        {/* STEP: Importing */}
        {step==="importing"&&(
          <div style={{textAlign:"center",padding:"30px 0"}}>
            <div style={{fontSize:32,marginBottom:12}}>⏳</div>
            <div style={{fontSize:14,fontWeight:700,marginBottom:8}}>Importazione in corso...</div>
            <div style={{background:c.bdl,borderRadius:10,height:8,overflow:"hidden",marginBottom:8}}>
              <div style={{width:progress+"%",height:"100%",background:"linear-gradient(90deg,#4F46E5,#7C3AED)",transition:"width 0.3s",borderRadius:10}}/>
            </div>
            <div style={{fontSize:11,color:c.txm}}>{progress}%</div>
          </div>
        )}

        {/* STEP: Done */}
        {step==="done"&&(
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <div style={{fontSize:48,marginBottom:12}}>✅</div>
            <div style={{fontSize:16,fontWeight:800,marginBottom:6}}>{importCount} trade importati!</div>
            <div style={{fontSize:12,color:c.txm,marginBottom:6,lineHeight:1.6}}>
              I trade sono ora nel tuo Journal.<br/>
              Apri ogni trade per aggiungere <strong>SL, MAE, MFE</strong> e note.
            </div>
            <div style={{background:c.tag,borderRadius:8,padding:10,fontSize:11,color:c.txm,marginBottom:20,textAlign:"left",lineHeight:1.6}}>
              💡 <strong>Consiglio:</strong> Vai nel Journal, filtra per data di importazione e arricchisci ogni trade con MAE/MFE guardando il grafico — questo sblocca tutte le analytics avanzate.
            </div>
            <button onClick={onClose}
              style={{padding:"10px 30px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              Vai al Journal →
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

// ── TRADE FORM ────────────────────────────────────────────────────────────────
function TradeForm({c,strategie,conti,reload,setScreen}){
  const {showConfirm,showAlert,ModalRenderer}=useModal();
  const [tab,setTab]=useState("main");
  const [saving,setSaving]=useState(false);
  // Pre-fill dates: oggi alla mezzanotte locale come punto di partenza
  function todayStr(){const n=new Date();const pad=function(x){return String(x).padStart(2,"0");};return n.getFullYear()+"-"+pad(n.getMonth()+1)+"-"+pad(n.getDate())+"T"+pad(n.getHours())+":"+pad(n.getMinutes());}
  const [form,setForm]=useState({conto_id:"",strategia_id:"",asset:"",mkt:"",direzione:"L",data_apertura:todayStr(),data_chiusura:todayStr(),r_result:"",mfe:"",rischio_eur:"",commissioni:"",screenshot_url:"",note_tec:"",note_psi:"",mood:"",sc_esecuzione:null,sc_complessivo:null,tags:[]});
  const [ck,setCk]=useState({});
  const [hasParz,setHasParz]=useState(false);
  const [parz,setParz]=useState([{size:"",percentuale:"",prezzo:"",data:"",be:false}]);
  const [assetOpen,setAssetOpen]=useState(false);
  const [assetQ,setAssetQ]=useState(form.asset||"");
  const assetRef=useRef(null);
  const MOODS=["😌 Calmo","😐 Neutro","😰 Ansioso","😤 Frustrato","😵 Euforico","😴 Stanco"];
  const TABS=[{k:"main",l:"Dati Trade",n:"1"},{k:"parziali",l:"Parziali",n:"2"},{k:"compliance",l:"✓ Checklist",n:"3"},{k:"journal",l:"Journal Emotivo",n:"4"}];
  const stratObj=strategie.find(function(s){return s.id===parseInt(form.strategia_id);});
  const ckItems=stratObj?[...(stratObj.checklist?.bias||[]),...(stratObj.checklist?.trigger||[]),...(stratObj.checklist?.contesto||[]),...(stratObj.checklist?.gestione||[])]:[];
  const r_result=parseFloat(form.r_result)||0;
  const pnl_eur=r_result&&form.rischio_eur?parseFloat((r_result*parseFloat(form.rischio_eur)).toFixed(2)):null;
  const contoObj=conti.find(function(cn){return cn.id===parseInt(form.conto_id);});
  const mktAssets=form.mkt?MKT[form.mkt].assets:[];
  const filteredA=mktAssets.filter(function(a){return a.toLowerCase().includes(assetQ.toLowerCase());});
  useEffect(function(){
    function fn(e){if(assetRef.current&&!assetRef.current.contains(e.target))setAssetOpen(false);}
    document.addEventListener("mousedown",fn);
    return function(){document.removeEventListener("mousedown",fn);};
  },[]);
  async function save(){
    const errors=[];
    if(!form.conto_id) errors.push("Seleziona un conto");
    if(!form.asset) errors.push("Seleziona un asset");
    if(form.r_result===""||form.r_result===null||form.r_result===undefined) errors.push("Inserisci il Risultato in R");
    if(isNaN(parseFloat(form.r_result))) errors.push("Risultato in R non valido (es. +2, -1, 0)");
    if(errors.length>0){showAlert("Controlla i campi","• "+errors.join("\n• "),"warning");return;}
    setSaving(true);
    const rVal=parseFloat(form.r_result);
    const rischioEur=form.rischio_eur?parseFloat(form.rischio_eur):null;
    const pnlEur=rischioEur!=null?parseFloat((rVal*rischioEur).toFixed(2)):null;
    const tradeData={
      conto_id:parseInt(form.conto_id),
      strategia_id:form.strategia_id?parseInt(form.strategia_id):null,
      asset:form.asset,
      direzione:form.direzione,
      data_apertura:form.data_apertura||new Date().toISOString(),
      data_chiusura:form.data_chiusura||new Date().toISOString(),
      mfe:form.mfe?parseFloat(form.mfe):null,
      rischio_eur:rischioEur,
      commissioni:form.commissioni?parseFloat(form.commissioni):0,
      pnl_eur:pnlEur,
      screenshot_url:form.screenshot_url||"",
      r_result:rVal,
      note_tec:form.note_tec||"",
      note_psi:form.note_psi||"",
      mood:form.mood||"",
      sc_esecuzione:form.sc_esecuzione,
      sc_complessivo:form.sc_complessivo,
      tags:form.tags||[],
      checklist:ck,
      parziali:[],
      created_at:new Date().toISOString(),
      draft:false,
    };
    await db.trade.add(tradeData);
    await reload();
    setSaving(false);
    setScreen("journal");
  }
  async function saveDraft(){
    if(!form.asset||!form.direzione){showAlert("Dati mancanti","Per la bozza servono almeno Asset e Direzione.","warning");return;}
    const draftData={
      conto_id:form.conto_id?parseInt(form.conto_id):null,
      strategia_id:form.strategia_id?parseInt(form.strategia_id):null,
      asset:form.asset,
      direzione:form.direzione,
      data_apertura:form.data_apertura||new Date().toISOString(),
      data_chiusura:form.data_chiusura||new Date().toISOString(),
      mfe:null,rischio_eur:null,commissioni:0,pnl_eur:null,screenshot_url:"",r_result:0,
      note_tec:form.note_tec||"",note_psi:"",mood:form.mood||"",
      sc_esecuzione:null,sc_complessivo:null,tags:form.tags||[],
      checklist:{},parziali:[],
      created_at:new Date().toISOString(),
      draft:true,
    };
    await db.trade.add(draftData);
    await reload();
    setScreen("journal");
  }
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"11px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:c.sb,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button onClick={function(){setScreen("dashboard");}} style={{padding:"4px 9px",borderRadius:6,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>← Indietro</button>
          <div><div style={{fontSize:14,fontWeight:700}}>Nuovo Trade</div></div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={saveDraft} style={{padding:"7px 14px",borderRadius:7,background:c.am+"18",border:"1px solid "+c.am+"40",color:c.am,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            📋 Salva Bozza
          </button>
          <button onClick={save} disabled={saving} style={{padding:"7px 18px",borderRadius:7,background:saving?"#6366F180":"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            {saving?"Salvataggio...":"💾 Salva Trade"}
          </button>
        </div>
      </div>
      <div style={{padding:"8px 20px",background:c.sb,borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
        {TABS.map(function(t){const a=tab===t.k;return(
          <button key={t.k} onClick={function(){setTab(t.k);}} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"inherit",background:a?"linear-gradient(135deg,#4F46E5,#7C3AED)":"transparent",color:a?"#fff":c.txm,fontSize:12,fontWeight:a?600:400}}>
            <span style={{width:18,height:18,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,background:a?"rgba(255,255,255,0.3)":c.tag,color:a?"#fff":c.txs,flexShrink:0}}>{t.n}</span>
            {t.l}
          </button>
        );})}
      </div>
      <div style={{flex:1,overflow:"auto",padding:"16px 20px"}}>
        {tab==="main"&&(
          <div style={{maxWidth:780}}>
            <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:10}}>
              <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:8,letterSpacing:"0.08em"}}>STEP 1 — CONTO & STRATEGIA</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:4}}>CONTO *</div>
                  <select value={form.conto_id} onChange={function(e){setForm({...form,conto_id:e.target.value});}} style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+(form.conto_id?c.gr+"60":c.inpb),background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                    <option value="">Seleziona conto...</option>
                    {conti.map(function(cn){return <option key={cn.id} value={cn.id}>{cn.nome}</option>;})}
                  </select>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:4}}>STRATEGIA</div>
                  <select value={form.strategia_id} onChange={function(e){setForm({...form,strategia_id:e.target.value});setCk({});}} style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                    <option value="">Nessuna strategia</option>
                    {strategie.map(function(s){return <option key={s.id} value={s.id}>{s.nome}</option>;})}
                  </select>
                </div>
              </div>
            </div>
            <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:10}}>
              <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:8,letterSpacing:"0.08em"}}>STEP 2 — STRUMENTO</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:8}}>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:4}}>MERCATO</div>
                  <select value={form.mkt} onChange={function(e){setForm({...form,mkt:e.target.value,asset:""});setAssetQ("");}} style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                    <option value="">Seleziona mercato...</option>
                    {Object.keys(MKT).map(function(m){return <option key={m} value={m}>{m}</option>;})}
                  </select>
                </div>
                <div ref={assetRef} style={{position:"relative"}}>
                  <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:4}}>ASSET *</div>
                  <input value={assetQ} onChange={function(e){setAssetQ(e.target.value);setForm({...form,asset:e.target.value.toUpperCase()});setAssetOpen(true);}} onFocus={function(){setAssetOpen(true);}} placeholder={form.mkt?"Cerca...":"Prima scegli mercato"} disabled={!form.mkt} style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+(form.asset?c.gr+"60":c.inpb),background:form.mkt?c.inp:c.tag,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box",opacity:form.mkt?1:0.6}}/>
                  {assetOpen&&form.mkt&&filteredA.length>0&&(
                    <div style={{position:"absolute",top:"calc(100% + 3px)",left:0,right:0,zIndex:200,background:c.card,border:"1px solid "+c.bd,borderRadius:8,boxShadow:"0 8px 24px rgba(0,0,0,0.12)",maxHeight:150,overflowY:"auto"}}>
                      {filteredA.map(function(a){return <div key={a} onClick={function(){setAssetQ(a);setForm({...form,asset:a});setAssetOpen(false);}} style={{padding:"7px 11px",cursor:"pointer",fontSize:12,color:c.tx}} onMouseEnter={function(e){e.currentTarget.style.background=c.tag;}} onMouseLeave={function(e){e.currentTarget.style.background="transparent";}}>{a}</div>;})}
                    </div>
                  )}
                </div>
              </div>
              <div style={{marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>DIREZIONE *</div>
                <div style={{display:"flex",gap:8}}>
                  {[{v:"L",l:"▲ Long"},{v:"S",l:"▼ Short"}].map(function(d){return(
                    <button key={d.v} onClick={function(){setForm({...form,direzione:d.v});}} style={{flex:1,padding:"8px",borderRadius:8,border:"2px solid "+(form.direzione===d.v?(d.v==="L"?c.gr:c.rd):c.bd),background:form.direzione===d.v?(d.v==="L"?c.gr+"12":c.rd+"12"):"transparent",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700,color:form.direzione===d.v?(d.v==="L"?c.gr:c.rd):c.txm}}>{d.l}</button>
                  );})}
                </div>
              </div>
            </div>
            <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:10}}>
              <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:8,letterSpacing:"0.08em"}}>STEP 3 — TIMING</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div><DatePicker label="DATA/ORA APERTURA" value={form.data_apertura} onChange={function(v){setForm(function(p){return {...p,data_apertura:v,data_chiusura:p.data_chiusura||v};});}} c={c}/></div>
                <div><DatePicker label="DATA/ORA CHIUSURA" value={form.data_chiusura||form.data_apertura} onChange={function(v){setForm(function(p){return {...p,data_chiusura:v};});}} c={c}/></div>
              </div>
              <div style={{fontSize:9,color:c.txm,marginTop:5}}>💡 La chiusura è preimpostata alla data apertura — cambia solo l'ora se necessario</div>
            </div>
            <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:10}}>
              <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:8,letterSpacing:"0.08em"}}>STEP 4 — RISULTATO IN R</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:10}}>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:3}}>RISULTATO *</div>
                  <input value={form.r_result} onChange={function(e){setForm({...form,r_result:e.target.value});}} placeholder="es. +2  /  -1  /  0" style={{width:"100%",padding:"9px 10px",borderRadius:7,border:"2px solid "+(form.r_result!==""?parseFloat(form.r_result)>0?c.gr:parseFloat(form.r_result)<0?c.rd:c.am:c.inpb),background:c.inp,color:form.r_result!==""?parseFloat(form.r_result)>0?c.gr:parseFloat(form.r_result)<0?c.rd:c.am:c.tx,fontSize:14,fontWeight:700,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                  <div style={{fontSize:9,color:c.txm,marginTop:3}}>Positivo = win · Negativo = loss · 0 = BE</div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:3}}>MFE IN R (opz.)</div>
                  <input value={form.mfe} onChange={function(e){setForm({...form,mfe:e.target.value});}} placeholder="es. 3.2" style={{width:"100%",padding:"9px 10px",borderRadius:7,border:"1px solid "+c.am+"50",background:c.inp,color:c.tx,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                  <div style={{fontSize:9,color:c.txm,marginTop:3}}>Massimo a favore raggiunto in R</div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:3}}>RISCHIO (€/$) (opz.)</div>
                  <input value={form.rischio_eur} onChange={function(e){setForm({...form,rischio_eur:e.target.value});}} placeholder="es. 100" style={{width:"100%",padding:"9px 10px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                  <div style={{fontSize:9,color:c.txm,marginTop:3}}>Rischiato su questo trade</div>
                </div>
              </div>
              {/* Preview calcolato */}
              {form.r_result!==""&&!isNaN(parseFloat(form.r_result))&&(
                <div style={{display:"flex",gap:8,padding:"10px 12px",borderRadius:9,background:c.bg,border:"1px solid "+c.bdl}}>
                  <div style={{textAlign:"center",flex:1}}>
                    <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:2}}>RISULTATO</div>
                    <div style={{fontSize:16,fontWeight:800,color:parseFloat(form.r_result)>0?c.gr:parseFloat(form.r_result)<0?c.rd:c.am}}>{parseFloat(form.r_result)>0?"+":""}{parseFloat(form.r_result)}R</div>
                  </div>
                  {form.rischio_eur&&!isNaN(parseFloat(form.rischio_eur))&&(
                    <div style={{textAlign:"center",flex:1,borderLeft:"1px solid "+c.bdl,paddingLeft:8}}>
                      <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:2}}>P/L IN €</div>
                      <div style={{fontSize:16,fontWeight:800,color:pnl_eur>=0?c.gr:c.rd}}>{pnl_eur>=0?"+":""}{pnl_eur}€</div>
                    </div>
                  )}
                  {form.mfe&&!isNaN(parseFloat(form.mfe))&&(
                    <div style={{textAlign:"center",flex:1,borderLeft:"1px solid "+c.bdl,paddingLeft:8}}>
                      <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:2}}>MFE</div>
                      <div style={{fontSize:16,fontWeight:800,color:c.gr}}>+{parseFloat(form.mfe)}R</div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{background:c.card,borderRadius:11,padding:"12px 15px",border:"1px solid "+c.bd,marginBottom:10}}>
              <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:8,letterSpacing:"0.08em"}}>EXTRA</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:3}}>COMMISSIONI (opz.)</div>
                  <input value={form.commissioni} onChange={function(e){setForm({...form,commissioni:e.target.value});}} placeholder="es. 3.50" style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:3}}>LINK SCREENSHOT (URL)</div>
                  <input value={form.screenshot_url} onChange={function(e){setForm({...form,screenshot_url:e.target.value});}} placeholder="https://www.tradingview.com/..." style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                </div>
              </div>
            </div>
          </div>
        )}
        {tab==="parziali"&&(
          <div style={{maxWidth:660}}>
            <div style={{display:"flex",alignItems:"center",gap:10,background:c.card,borderRadius:11,padding:"12px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
              <input type="checkbox" checked={hasParz} onChange={function(e){setHasParz(e.target.checked);}} style={{width:15,height:15,cursor:"pointer",accentColor:c.ac}}/>
              <div><div style={{fontSize:12,fontWeight:600}}>Ho chiuso parziali su questo trade</div></div>
            </div>
            {hasParz&&parz.map(function(p,i){return(
              <div key={i} style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:700,color:c.txm,marginBottom:8}}>PARZIALE #{i+1}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                  {[{l:"SIZE",k:"size"},{l:"% POSIZIONE",k:"percentuale"},{l:"PREZZO",k:"prezzo"}].map(function(f){return(
                    <div key={f.k}><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:3}}>{f.l}</div><input value={p[f.k]||""} onChange={function(e){const np=[...parz];np[i]={...np[i],[f.k]:e.target.value};setParz(np);}} style={{width:"100%",padding:"7px 9px",borderRadius:6,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
                  );})}
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,cursor:"pointer"}}><input type="checkbox" checked={p.be||false} onChange={function(e){const np=[...parz];np[i]={...np[i],be:e.target.checked};setParz(np);}} style={{width:13,height:13,accentColor:c.ac}}/> Breakeven</label>
                  <button onClick={function(){setParz(parz.filter(function(_,j){return j!==i;}));}} style={{marginLeft:"auto",padding:"4px 9px",borderRadius:6,border:"1px solid "+c.rd+"40",background:c.rd+"10",color:c.rd,fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>Rimuovi</button>
                </div>
              </div>
            );})}
            {hasParz&&<button onClick={function(){setParz([...parz,{size:"",percentuale:"",prezzo:"",be:false}]);}} style={{width:"100%",padding:"8px",borderRadius:9,border:"1px dashed "+c.ac+"60",background:c.ac+"08",color:c.ac,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>+ Aggiungi parziale</button>}
          </div>
        )}
        {tab==="compliance"&&(
          <div style={{maxWidth:660}}>
            {!stratObj||ckItems.length===0?(
              <div style={{padding:"40px",textAlign:"center",color:c.txm,fontSize:12,background:c.card,borderRadius:11,border:"1px solid "+c.bd}}>
                <div style={{fontSize:24,marginBottom:8}}>📋</div>
                <div style={{fontWeight:700,marginBottom:4}}>Nessuna checklist disponibile</div>
                <div style={{lineHeight:1.6}}>Seleziona una strategia con checklist nel tab "Dati Trade" per compilare la compliance.</div>
              </div>
            ):(
              <div>
                <div style={{background:c.card,borderRadius:11,padding:"14px 15px",border:"1px solid "+c.bd,marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                    <div style={{fontSize:13,fontWeight:800}}>Checklist — {stratObj.nome}</div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{fontSize:11,color:c.txm}}>{Object.values(ck).filter(Boolean).length}/{ckItems.length} rispettate</div>
                      <div style={{
                        padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,
                        background:(Object.values(ck).filter(Boolean).length/ckItems.length)>=0.8?c.gr+"15":
                                   (Object.values(ck).filter(Boolean).length/ckItems.length)>=0.5?c.am+"15":c.rd+"15",
                        color:(Object.values(ck).filter(Boolean).length/ckItems.length)>=0.8?c.gr:
                              (Object.values(ck).filter(Boolean).length/ckItems.length)>=0.5?c.am:c.rd,
                      }}>
                        {Math.round((Object.values(ck).filter(Boolean).length/ckItems.length)*100)}%
                      </div>
                    </div>
                  </div>
                  {/* Barra progresso */}
                  <div style={{background:c.bdl,borderRadius:10,height:6,marginBottom:14,overflow:"hidden"}}>
                    <div style={{
                      width:Math.round((Object.values(ck).filter(Boolean).length/ckItems.length)*100)+"%",
                      height:"100%",borderRadius:10,transition:"width 0.3s",
                      background:(Object.values(ck).filter(Boolean).length/ckItems.length)>=0.8?"linear-gradient(90deg,#22C55E,#16A34A)":
                                 (Object.values(ck).filter(Boolean).length/ckItems.length)>=0.5?"linear-gradient(90deg,#F59E0B,#D97706)":
                                 "linear-gradient(90deg,#EF4444,#DC2626)",
                    }}/>
                  </div>
                  {/* Voci checklist per categoria */}
                  {(function(){
                    const cats=["bias","trigger","contesto","gestione"];
                    const catLabels={bias:"📐 Bias",trigger:"⚡ Trigger",contesto:"🌍 Contesto",gestione:"⚙ Gestione"};
                    return cats.map(function(cat){
                      const items=stratObj.checklist?.[cat]||[];
                      if(items.length===0) return null;
                      const catChecked=items.filter(function(item){return !!ck[item];}).length;
                      return(
                        <div key={cat} style={{marginBottom:12}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                            <div style={{fontSize:10,fontWeight:800,color:c.txm,textTransform:"uppercase",letterSpacing:"0.06em"}}>{catLabels[cat]}</div>
                            <div style={{fontSize:10,color:c.txm}}>{catChecked}/{items.length}</div>
                          </div>
                          {items.map(function(item,i){
                            const checked=!!ck[item];
                            return(
                              <div key={i}
                                onClick={function(){const n={...ck};n[item]=!n[item];setCk(n);}}
                                style={{
                                  display:"flex",alignItems:"center",gap:10,padding:"9px 12px",
                                  borderRadius:8,marginBottom:4,cursor:"pointer",
                                  background:checked?c.gr+"10":"transparent",
                                  border:"1px solid "+(checked?c.gr+"30":c.bd),
                                  transition:"all 0.15s",
                                }}>
                                <div style={{
                                  width:18,height:18,borderRadius:5,flexShrink:0,
                                  background:checked?"linear-gradient(135deg,#22C55E,#16A34A)":c.inp,
                                  border:"1.5px solid "+(checked?c.gr:c.inpb),
                                  display:"flex",alignItems:"center",justifyContent:"center",
                                }}>
                                  {checked&&<span style={{fontSize:10,color:"#fff",fontWeight:700}}>✓</span>}
                                </div>
                                <span style={{fontSize:12,color:checked?c.tx:c.txm,fontWeight:checked?600:400,flex:1}}>{item}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    });
                  })()}
                  {/* Quick actions */}
                  <div style={{display:"flex",gap:6,marginTop:8}}>
                    <button onClick={function(){const n={};ckItems.forEach(function(i){n[i]=true;});setCk(n);}}
                      style={{padding:"5px 12px",borderRadius:6,border:"1px solid "+c.gr+"40",background:c.gr+"10",color:c.gr,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                      ✓ Seleziona tutto
                    </button>
                    <button onClick={function(){setCk({});}}
                      style={{padding:"5px 12px",borderRadius:6,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>
                      ✕ Deseleziona tutto
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {tab==="journal"&&(
          <div style={{maxWidth:660}}>
            <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Stato Mentale Pre-Trade</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                {MOODS.map(function(m){return <button key={m} onClick={function(){setForm({...form,mood:m});}} style={{padding:"6px 11px",borderRadius:7,border:"1px solid "+(form.mood===m?c.ac:c.bd),background:form.mood===m?c.ac+"15":"transparent",color:form.mood===m?c.ac:c.tx,fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:form.mood===m?600:400}}>{m}</button>;})}
              </div>
            </div>
            {stratObj&&ckItems.length>0&&(
              <div style={{padding:"8px 12px",borderRadius:8,background:c.ac+"10",border:"1px solid "+c.ac+"20",fontSize:11,color:c.ac,marginBottom:10,cursor:"pointer"}}
                onClick={function(){setTab("compliance");}}>
                ✓ Checklist: {Object.values(ck).filter(Boolean).length}/{ckItems.length} voci rispettate — clicca per aprire il tab Checklist
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              {[{t:"Voto Esecuzione",k:"sc_esecuzione"},{t:"Voto Complessivo",k:"sc_complessivo"}].map(function(v){return(
                <div key={v.k} style={{background:c.card,borderRadius:11,padding:"11px 13px",border:"1px solid "+c.bd}}>
                  <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>{v.t}</div>
                  <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                    {[1,2,3,4,5,6,7,8,9,10].map(function(n){const sel=form[v.k]===n;return <button key={n} onClick={function(){setForm({...form,[v.k]:n});}} style={{width:28,height:28,borderRadius:6,border:"1.5px solid "+(sel?(n>=7?c.gr:n>=5?c.am:c.rd):c.bd),background:sel?(n>=7?c.gr+"15":n>=5?c.am+"15":c.rd+"15"):c.tag,color:n>=7?c.gr:n>=5?c.am:c.rd,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{n}</button>;})}
                  </div>
                </div>
              );})}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {[{l:"NOTE TECNICHE",k:"note_tec",ph:"Cosa ha funzionato?"},{l:"NOTE PSICOLOGICHE",k:"note_psi",ph:"FOMO? Hesitation?"}].map(function(n){return(
                <div key={n.k}><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:4}}>{n.l}</div><textarea value={form[n.k]} onChange={function(e){setForm({...form,[n.k]:e.target.value});}} placeholder={n.ph} style={{width:"100%",height:80,padding:"8px 10px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",resize:"vertical",outline:"none",boxSizing:"border-box"}}/></div>
              );})}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── JOURNAL DETAIL ────────────────────────────────────────────────────────────
function JournalDetail({trade,c,onBack,strategie,reload,conti}){
  const strat=strategie.find(function(s){return s.id===trade.strategia_id;})||null;
  const win=trade.r_result>0;const be=trade.r_result===0;
  const ckItems=strat?[...(strat.checklist?.bias||[]),...(strat.checklist?.trigger||[]),...(strat.checklist?.contesto||[]),...(strat.checklist?.gestione||[])]:[];
  const [editing,setEditing]=useState(false);
  const [eform,setEform]=useState({
    note_tec:trade.note_tec||"",
    note_psi:trade.note_psi||"",
    mood:trade.mood||"",
    sc_esecuzione:trade.sc_esecuzione||null,
    sc_complessivo:trade.sc_complessivo||null,
    screenshot_url:trade.screenshot_url||"",
    r_result:trade.r_result!=null?String(trade.r_result):"",
    mfe:trade.mfe!=null?String(trade.mfe):"",
    rischio_eur:trade.rischio_eur!=null?String(trade.rischio_eur):"",
  });
  const MOODS=["😌 Calmo","😐 Neutro","😰 Ansioso","😤 Frustrato","😵 Euforico","😴 Stanco"];
  async function saveEdit(){
    const rVal=parseFloat(eform.r_result)||trade.r_result||0;
    const rischioEur=eform.rischio_eur?parseFloat(eform.rischio_eur):trade.rischio_eur||null;
    const pnlEur=rischioEur!=null?parseFloat((rVal*rischioEur).toFixed(2)):null;
    await db.trade.update(trade.id,{
      r_result:rVal,
      mfe:eform.mfe?parseFloat(eform.mfe):null,
      rischio_eur:rischioEur,
      pnl_eur:pnlEur,
      note_tec:eform.note_tec,
      note_psi:eform.note_psi,
      mood:eform.mood,
      sc_esecuzione:eform.sc_esecuzione,
      sc_complessivo:eform.sc_complessivo,
      screenshot_url:eform.screenshot_url,
    });
    await reload();
    setEditing(false);
    onBack();
  }
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"11px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",gap:10,background:c.sb,flexShrink:0}}>
        <button onClick={onBack} style={{padding:"4px 9px",borderRadius:6,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>← Journal</button>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:28,height:28,borderRadius:6,fontSize:10,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",background:trade.direzione==="L"?c.gr+"18":c.rd+"18",color:trade.direzione==="L"?c.gr:c.rd,border:"1px solid "+(trade.direzione==="L"?c.gr+"44":c.rd+"44")}}>{trade.direzione==="L"?"▲":"▼"}</div>
          <div><div style={{fontSize:14,fontWeight:700}}>{trade.asset}</div><div style={{fontSize:10,color:c.txm}}>{fmtDate(trade.data_apertura)}{strat?" · "+strat.nome:""}</div></div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          <Badge v={trade.r_result} c={c}/>
          <button onClick={function(){setEditing(true);}} style={{padding:"5px 12px",borderRadius:7,border:"1px solid "+c.ac+"40",background:c.ac+"10",color:c.ac,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>✏ Modifica</button>
        </div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"16px 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Risultato</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[
                {l:"Risultato R",v:fmtR(trade.r_result),col:trade.r_result>0?c.gr:trade.r_result<0?c.rd:c.am},
                {l:"MFE in R",v:trade.mfe!=null?"+"+trade.mfe+"R":"—",col:c.gr},
                {l:"P/L in €",v:trade.pnl_eur!=null?(trade.pnl_eur>=0?"+":"")+trade.pnl_eur+"€":"—",col:trade.pnl_eur>=0?c.gr:c.rd},
                {l:"Rischio €",v:trade.rischio_eur!=null?trade.rischio_eur+"€":"—",col:c.tx},
                {l:"Direzione",v:trade.direzione==="L"?"Long ▲":"Short ▼",col:trade.direzione==="L"?c.gr:c.rd},
                {l:"Durata",v:(function(){if(!trade.data_apertura||!trade.data_chiusura)return "—";const d=Math.round((new Date(trade.data_chiusura)-new Date(trade.data_apertura))/60000);return d<60?d+"min":Math.floor(d/60)+"h "+(d%60)+"m";})(),col:c.tx},
              ].map(function(f,i){return(
                <div key={i} style={{background:c.bg,borderRadius:7,padding:"8px 10px"}}><div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:2}}>{f.l}</div><div style={{fontSize:12,fontWeight:700,color:f.col||c.tx}}>{f.v}</div></div>
              );})}
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Risultato</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[{l:"R Risultato",v:fmtR(trade.r_result),col:win?c.gr:be?c.txm:c.rd},{l:"Voto Esecuzione",v:(trade.sc_esecuzione||"—")+"/10",col:trade.sc_esecuzione>=7?c.gr:trade.sc_esecuzione>=5?c.am:c.rd},{l:"Voto Complessivo",v:(trade.sc_complessivo||"—")+"/10",col:trade.sc_complessivo>=7?c.gr:trade.sc_complessivo>=5?c.am:c.rd},{l:"Stato Mentale",v:trade.mood||"—",col:c.tx}].map(function(f,i){return(
                  <div key={i} style={{background:c.bg,borderRadius:7,padding:"8px 10px"}}><div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:2}}>{f.l}</div><div style={{fontSize:13,fontWeight:700,color:f.col}}>{f.v}</div></div>
                );})}
              </div>
            </div>
          </div>
        </div>
        {trade.parziali&&trade.parziali.length>0&&(
          <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>Parziali</div>
            <div style={{fontSize:10,color:c.txm,marginBottom:8,padding:"6px 10px",borderRadius:7,background:c.am+"08",border:"1px solid "+c.am+"20"}}>
              R ponderato: il risultato finale tiene conto di ogni uscita parziale × % della posizione chiusa.
            </div>
            {trade.parziali.map(function(p,i){
              return(
                <div key={i} style={{display:"flex",gap:12,padding:"8px 10px",borderRadius:8,background:c.bg,marginBottom:6,alignItems:"center"}}>
                  <div style={{flex:1}}><div style={{fontSize:9,color:c.txm}}>% Posizione</div><div style={{fontSize:11,fontWeight:600}}>{p.percentuale||"—"}%</div></div>
                  <div style={{flex:1}}><div style={{fontSize:9,color:c.txm}}>R parziale</div><div style={{fontSize:11,fontWeight:600,color:c.gr}}>{p.r_parziale!=null?fmtR(p.r_parziale):"—"}</div></div>
                  {p.be&&<div style={{fontSize:10,fontWeight:700,color:c.am,padding:"2px 7px",borderRadius:20,background:c.am+"15"}}>BE</div>}
                </div>
              );
            })}
          </div>
        )}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Note Tecniche</div>
            <div style={{fontSize:12,color:c.tx,lineHeight:1.6}}>{trade.note_tec||"—"}</div>
          </div>
          <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Note Psicologiche</div>
            <div style={{fontSize:12,color:c.tx,lineHeight:1.6}}>{trade.note_psi||"—"}</div>
          </div>
        </div>
        {(trade.screenshot_url||trade.pnl_eur!=null)&&(
          <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Extra</div>
            <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
              {trade.pnl_eur!=null&&(
                <div style={{background:c.bg,borderRadius:8,padding:"8px 14px"}}>
                  <div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:2}}>P/L IN VALUTA</div>
                  <div style={{fontSize:14,fontWeight:700,color:trade.pnl_eur>=0?c.gr:c.rd}}>{trade.pnl_eur>=0?"+":""}{trade.pnl_eur}</div>
                </div>
              )}
              {trade.screenshot_url&&(
                <a href={trade.screenshot_url} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",borderRadius:8,background:c.ac+"10",border:"1px solid "+c.ac+"30",color:c.ac,fontSize:12,fontWeight:600,textDecoration:"none"}}>📸 Apri Screenshot</a>
              )}
            </div>
          </div>
        )}
        {strat&&ckItems.length>0&&(
          <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Checklist — {strat.nome}</div>
            {ckItems.map(function(item,i){const checked=trade.checklist&&trade.checklist[item];return(
              <div key={i} style={{display:"flex",alignItems:"center",gap:7,padding:"5px 0",borderBottom:"1px solid "+c.bdl}}>
                <span style={{fontSize:12,color:checked?c.gr:c.rd}}>{checked?"✓":"✕"}</span>
                <span style={{fontSize:11,color:c.tx}}>{item}</span>
              </div>
            );})}
          </div>
        )}
      </div>
      {/* MODALE MODIFICA */}
      {editing&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){setEditing(false);}}>
          <div style={{background:c.card,borderRadius:14,padding:"24px",width:600,maxHeight:"88vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}} onClick={function(e){e.stopPropagation();}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
              <div style={{fontSize:15,fontWeight:700}}>Modifica Trade — {trade.asset}</div>
              <button onClick={function(){setEditing(false);}} style={{width:28,height:28,borderRadius:7,border:"1px solid "+c.bd,background:c.tag,cursor:"pointer",fontSize:16,color:c.txm,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
            </div>
            <div style={{fontSize:9,color:c.txm,marginBottom:14,padding:"7px 10px",borderRadius:7,background:c.ac+"08",border:"1px solid "+c.ac+"20"}}>Puoi modificare prezzi, note, voti e screenshot. L'R viene ricalcolato automaticamente.</div>
            {/* risultato in R */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,fontWeight:700,color:c.txm,marginBottom:8,letterSpacing:"0.06em"}}>RISULTATO & MFE</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                {[{l:"Risultato R *",k:"r_result",ph:"es. +2 / -1 / 0"},{l:"MFE in R (opz.)",k:"mfe",ph:"es. 3.2"},{l:"Rischio € (opz.)",k:"rischio_eur",ph:"es. 100"}].map(function(f){return(
                  <div key={f.k}><div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:3}}>{f.l}</div><input value={eform[f.k]||""} onChange={function(e){setEform({...eform,[f.k]:e.target.value});}} placeholder={f.ph} style={{width:"100%",padding:"7px 9px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
                );})}
              </div>
            </div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,fontWeight:700,color:c.txm,marginBottom:8,letterSpacing:"0.06em"}}>SCREENSHOT</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr",gap:8}}>
                {[{l:"Link Screenshot",k:"screenshot_url",ph:"https://www.tradingview.com/..."}].map(function(f){return(
                  <div key={f.k}><div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:3}}>{f.l}</div><input value={eform[f.k]||""} onChange={function(e){setEform({...eform,[f.k]:e.target.value});}} placeholder={f.ph||""} style={{width:"100%",padding:"7px 9px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
                );})}
              </div>
            </div>
            {/* mood */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,fontWeight:700,color:c.txm,marginBottom:7,letterSpacing:"0.06em"}}>STATO MENTALE</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {MOODS.map(function(m){return <button key={m} onClick={function(){setEform({...eform,mood:m});}} style={{padding:"5px 10px",borderRadius:7,border:"1px solid "+(eform.mood===m?c.ac:c.bd),background:eform.mood===m?c.ac+"15":"transparent",color:eform.mood===m?c.ac:c.tx,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:eform.mood===m?600:400}}>{m}</button>;})}
              </div>
            </div>
            {/* voti */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              {[{t:"Voto Esecuzione",k:"sc_esecuzione"},{t:"Voto Complessivo",k:"sc_complessivo"}].map(function(v){return(
                <div key={v.k} style={{background:c.bg,borderRadius:9,padding:"10px 12px"}}>
                  <div style={{fontSize:10,fontWeight:700,marginBottom:7}}>{v.t}</div>
                  <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                    {[1,2,3,4,5,6,7,8,9,10].map(function(n){const sel=eform[v.k]===n;return <button key={n} onClick={function(){setEform({...eform,[v.k]:n});}} style={{width:26,height:26,borderRadius:5,border:"1.5px solid "+(sel?(n>=7?c.gr:n>=5?c.am:c.rd):c.bd),background:sel?(n>=7?c.gr+"15":n>=5?c.am+"15":c.rd+"15"):c.card,color:n>=7?c.gr:n>=5?c.am:c.rd,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{n}</button>;})}
                  </div>
                </div>
              );})}
            </div>
            {/* note */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:18}}>
              {[{l:"NOTE TECNICHE",k:"note_tec"},{l:"NOTE PSICOLOGICHE",k:"note_psi"}].map(function(n){return(
                <div key={n.k}><div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:4}}>{n.l}</div><textarea value={eform[n.k]||""} onChange={function(e){setEform({...eform,[n.k]:e.target.value});}} style={{width:"100%",height:70,padding:"7px 9px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",resize:"vertical",outline:"none",boxSizing:"border-box"}}/></div>
              );})}
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={function(){setEditing(false);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
              <button onClick={saveEdit} style={{padding:"8px 20px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>💾 Salva Modifiche</button>
            </div>
          </div>
        </div>
      )}
      <ModalRenderer c={c}/>
    </div>
  );
}

// ── JOURNAL ───────────────────────────────────────────────────────────────────
function Journal({c,trades,strategie,conti,reload}){
  const [filtDir,setFiltDir]=useState("tutti");
  const [filtRis,setFiltRis]=useState("tutti");
  const [filtAsset,setFiltAsset]=useState("tutti");
  const [filtStrat,setFiltStrat]=useState("tutti");
  const [detail,setDetail]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  if(detail) return <JournalDetail trade={detail} c={c} onBack={function(){setDetail(null);}} strategie={strategie} reload={reload} conti={conti}/>;

  const drafts=trades.filter(function(t){return t.draft===true;});
  const realTrades=trades.filter(function(t){return !t.draft;});

  const assets=["tutti",...Array.from(new Set(realTrades.map(function(t){return t.asset;})))];
  const sorted=realTrades.slice().sort(function(a,b){return new Date(b.data_apertura)-new Date(a.data_apertura);});
  const filtered=sorted.filter(function(t){
    if(filtDir==="long"&&t.direzione!=="L") return false;
    if(filtDir==="short"&&t.direzione!=="S") return false;
    if(filtRis==="win"&&t.r_result<=0) return false;
    if(filtRis==="loss"&&t.r_result>=0) return false;
    if(filtRis==="be"&&t.r_result!==0) return false;
    if(filtAsset!=="tutti"&&t.asset!==filtAsset) return false;
    if(filtStrat!=="tutti"&&String(t.strategia_id)!==filtStrat) return false;
    return true;
  });
  async function delTrade(id){await db.trade.delete(id);await reload();setConfirmDel(null);}

  function TradeRow({t,i,len,isDraft}){
    const strat=strategie.find(function(s){return s.id===t.strategia_id;});
    const integrity=calcIntegrityScore(t);
    const rowBg=isDraft?c.am+"08":"transparent";
    return(
      <div
        key={t.id}
        style={{display:"grid",gridTemplateColumns:"90px 80px 50px 120px 70px 50px 40px 40px 30px",gap:0,padding:"10px 16px",borderBottom:i<len-1?"1px solid "+c.bdl:"none",alignItems:"center",cursor:"pointer",background:rowBg,transition:"background 0.15s"}}
        onClick={function(){setDetail(t);}}
        onMouseEnter={function(e){e.currentTarget.style.background=isDraft?c.am+"14":c.nav;}}
        onMouseLeave={function(e){e.currentTarget.style.background=rowBg;}}
      >
        <div>
          <div style={{fontSize:11,fontWeight:600}}>{fmtDate(t.data_apertura)}</div>
          {isDraft&&<div style={{fontSize:8,fontWeight:700,color:c.am,marginTop:1}}>📋 BOZZA</div>}
        </div>
        <div style={{fontWeight:700,fontSize:12}}>{t.asset||"—"}</div>
        <div><span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:26,height:16,borderRadius:3,fontSize:9,fontWeight:700,background:t.direzione==="L"?c.gr+"18":c.rd+"18",color:t.direzione==="L"?c.gr:c.rd}}>{t.direzione==="L"?"▲L":"▼S"}</span></div>
        <div style={{fontSize:10,color:c.txm,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{strat?strat.nome:"—"}</div>
        <div>{isDraft?<span style={{fontSize:10,color:c.am}}>da completare</span>:<Badge v={t.r_result} c={c}/>}</div>
        <div style={{fontSize:14}}>{t.mood?t.mood.split(" ")[0]:"—"}</div>
        <div style={{fontSize:11,fontWeight:700,color:t.sc_esecuzione>=7?c.gr:t.sc_esecuzione>=5?c.am:c.rd}}>{t.sc_esecuzione||"—"}</div>
        <div style={{display:"flex",alignItems:"center",gap:2}}>
          <div style={{width:24,height:24,borderRadius:6,background:integrity>=70?c.gr+"20":integrity>=40?c.am+"20":c.rd+"20",border:"1px solid "+(integrity>=70?c.gr+"40":integrity>=40?c.am+"40":c.rd+"40"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,color:integrity>=70?c.gr:integrity>=40?c.am:c.rd}} title={"Integrity Score: "+integrity+"/100"}>{integrity}</div>
        </div>
        <div onClick={function(e){e.stopPropagation();setConfirmDel(t.id);}} style={{fontSize:11,color:c.rd,cursor:"pointer",opacity:0.6}} onMouseEnter={function(e){e.currentTarget.style.opacity=1;}} onMouseLeave={function(e){e.currentTarget.style.opacity=0.6;}}>✕</div>
      </div>
    );
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"12px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:c.sb,flexShrink:0}}>
        <div>
          <div style={{fontSize:15,fontWeight:700,letterSpacing:"-0.02em"}}>Journal</div>
          <div style={{fontSize:10,color:c.txm}}>{filtered.length} trade{drafts.length>0?" · "+drafts.length+" bozze da completare":""}</div>
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          <select value={filtDir} onChange={function(e){setFiltDir(e.target.value);}} style={{padding:"5px 8px",borderRadius:7,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",cursor:"pointer"}}>
            <option value="tutti">Direzione</option><option value="long">Long</option><option value="short">Short</option>
          </select>
          <select value={filtRis} onChange={function(e){setFiltRis(e.target.value);}} style={{padding:"5px 8px",borderRadius:7,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",cursor:"pointer"}}>
            <option value="tutti">Risultato</option><option value="win">Win</option><option value="loss">Loss</option><option value="be">BE</option>
          </select>
          <select value={filtAsset} onChange={function(e){setFiltAsset(e.target.value);}} style={{padding:"5px 8px",borderRadius:7,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",cursor:"pointer"}}>
            {assets.map(function(a){return <option key={a} value={a}>{a==="tutti"?"Asset":a}</option>;})}
          </select>
          <select value={filtStrat} onChange={function(e){setFiltStrat(e.target.value);}} style={{padding:"5px 8px",borderRadius:7,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",cursor:"pointer"}}>
            <option value="tutti">Strategia</option>
            {strategie.map(function(s){return <option key={s.id} value={String(s.id)}>{s.nome}</option>;})}
          </select>
        </div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        {trades.length===0?(
          <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Nessun trade ancora. Clicca "+ Nuovo Trade" per iniziare!</div>
        ):(
          <>
            {/* SEZIONE BOZZE */}
            {drafts.length>0&&(
              <div style={{marginBottom:14}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:700,color:c.am,letterSpacing:"0.05em"}}>📋 BOZZE DA COMPLETARE</div>
                  <div style={{flex:1,height:1,background:c.am+"30"}}/>
                  <div style={{fontSize:10,color:c.am,background:c.am+"15",padding:"2px 8px",borderRadius:10,border:"1px solid "+c.am+"40"}}>{drafts.length}</div>
                </div>
                <div style={{background:c.card,borderRadius:12,border:"1px solid "+c.am+"40",overflow:"hidden"}}>
                  <div style={{display:"grid",gridTemplateColumns:"90px 80px 50px 120px 70px 50px 40px 40px 30px",gap:0,padding:"7px 16px",background:c.am+"10",borderBottom:"1px solid "+c.am+"30"}}>
                    {["Data","Asset","Dir.","Strategia","Stato","Mood","★","Int.",""].map(function(h,i){return <div key={i} style={{fontSize:8,color:c.am,fontWeight:700,letterSpacing:"0.05em"}}>{h}</div>;})}
                  </div>
                  {drafts.sort(function(a,b){return new Date(b.data_apertura)-new Date(a.data_apertura);}).map(function(t,i){
                    return <TradeRow key={t.id} t={t} i={i} len={drafts.length} isDraft={true}/>;
                  })}
                </div>
                <div style={{fontSize:10,color:c.txm,marginTop:6,paddingLeft:2}}>💡 Clicca su una bozza per completarla con prezzi, MAE/MFE e note</div>
              </div>
            )}
            {/* TRADE REALI */}
            <div style={{background:c.card,borderRadius:12,border:"1px solid "+c.bd,overflow:"hidden"}}>
              <div style={{display:"grid",gridTemplateColumns:"90px 80px 50px 120px 70px 50px 40px 40px 30px",gap:0,padding:"8px 16px",borderBottom:"1px solid "+c.bd,background:c.bg}}>
                {["Data","Asset","Dir.","Strategia","R","Mood","★","Int.",""].map(function(h,i){return <div key={i} style={{fontSize:8,color:c.txs,fontWeight:700,letterSpacing:"0.05em"}}>{h}</div>;})}
              </div>
              {filtered.length===0&&<div style={{padding:"30px",textAlign:"center",color:c.txm,fontSize:12}}>Nessun trade con i filtri selezionati</div>}
              {filtered.map(function(t,i){
                return <TradeRow key={t.id} t={t} i={i} len={filtered.length} isDraft={false}/>;
              })}
            </div>
          </>
        )}
      </div>
      {confirmDel&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:c.card,borderRadius:12,padding:"24px",width:320,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:8}}>Elimina Trade</div>
            <div style={{fontSize:12,color:c.txm,marginBottom:20}}>Eliminare questo trade? L'azione non può essere annullata.</div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={function(){setConfirmDel(null);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
              <button onClick={function(){delTrade(confirmDel);}} style={{padding:"8px 16px",borderRadius:8,background:c.rd,border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Elimina</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── HEATMAP CALENDARIO ─────────────────────────────────────────────────────────
function CalHeatmap({trades,c}){
  if(!trades||trades.length===0) return(
    <div style={{textAlign:"center",padding:"40px",color:c.txm,fontSize:12}}>Nessun trade nel periodo selezionato.</div>
  );

  // Raggruppa trade per giorno
  const byDay={};
  trades.forEach(function(t){
    if(!t.data_apertura) return;
    const day=t.data_apertura.slice(0,10);
    if(!byDay[day]) byDay[day]={r:0,n:0,wins:0,losses:0};
    byDay[day].r+=t.r_result||0;
    byDay[day].n++;
    if((t.r_result||0)>0) byDay[day].wins++;
    else if((t.r_result||0)<0) byDay[day].losses++;
  });

  const allDays=Object.keys(byDay).sort();
  if(allDays.length===0) return(
    <div style={{textAlign:"center",padding:"40px",color:c.txm,fontSize:12}}>Nessun trade con data valida.</div>
  );

  // Range mesi
  const firstDate=new Date(allDays[0]+"T00:00:00");
  const lastDate=new Date(allDays[allDays.length-1]+"T00:00:00");
  const months=[];
  let cur=new Date(firstDate.getFullYear(),firstDate.getMonth(),1);
  const endMonth=new Date(lastDate.getFullYear(),lastDate.getMonth(),1);
  while(cur<=endMonth){
    months.push(new Date(cur.getFullYear(),cur.getMonth(),1));
    cur=new Date(cur.getFullYear(),cur.getMonth()+1,1);
  }

  const monthNames=["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
  const dayNames=["L","M","M","G","V","S","D"];

  const rVals=Object.values(byDay).map(function(d){return Math.abs(d.r);});
  const maxAbs=rVals.length>0?Math.max.apply(null,rVals):1;

  function getCellBg(r){
    if(r===undefined||r===null) return "transparent";
    if(Math.abs(r)<0.005) return c.tag;
    const intensity=Math.min(Math.abs(r)/Math.max(maxAbs,0.01),1);
    const alpha=0.18+intensity*0.72;
    if(r>0) return "rgba(34,197,94,"+alpha.toFixed(2)+")";
    return "rgba(239,68,68,"+alpha.toFixed(2)+")";
  }

  // 4 mesi per riga, poi va a capo
  const COLS=4;
  const rows=[];
  for(let i=0;i<months.length;i+=COLS){
    rows.push(months.slice(i,i+COLS));
  }

  const CELL=34; // px cella
  const GAP=3;

  return(
    <div>
      {rows.map(function(rowMonths,ri){return(
        <div key={ri} style={{display:"flex",gap:20,marginBottom:24,flexWrap:"nowrap"}}>
          {rowMonths.map(function(monthStart,mi){
            const yr=monthStart.getFullYear();
            const mo=monthStart.getMonth();
            const daysInMonth=new Date(yr,mo+1,0).getDate();
            const firstDow=(new Date(yr,mo,1).getDay()+6)%7; // 0=Lun

            const cells=[];

            // Header giorni settimana
            dayNames.forEach(function(dn,di){
              cells.push(
                <div key={"h"+di} style={{width:CELL,height:18,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:c.txm}}>
                  {dn}
                </div>
              );
            });

            // Celle vuote iniziali
            for(var e=0;e<firstDow;e++){
              cells.push(<div key={"e"+e} style={{width:CELL,height:CELL}}/>);
            }

            // Celle giorni
            for(var d=1;d<=daysInMonth;d++){
              var mo2=String(mo+1).padStart(2,"0");
              var d2=String(d).padStart(2,"0");
              var dateStr=yr+"-"+mo2+"-"+d2;
              var data=byDay[dateStr];
              var bg=getCellBg(data?data.r:undefined);
              var hasTrade=!!data;
              var tip=dateStr+(data?" — "+data.n+" trade | R: "+(data.r>=0?"+":"")+data.r.toFixed(2)+(data.wins>0?" | ✓"+data.wins:"")+(data.losses>0?" | ✗"+data.losses:""):"");
              var textColor=hasTrade?(Math.abs(data.r)>maxAbs*0.5?"#fff":c.tx):c.txm+"60";
              cells.push(
                <div key={"d"+d} title={tip} style={{
                  width:CELL,height:CELL,
                  borderRadius:5,
                  background:bg,
                  border:"1px solid "+(hasTrade?c.bd+"90":c.bd+"40"),
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                  fontSize:10,
                  fontWeight:hasTrade?700:400,
                  color:textColor,
                  cursor:hasTrade?"default":"default",
                  position:"relative",
                  transition:"transform 0.1s",
                }}>
                  {d}
                </div>
              );
            }

            return(
              <div key={mi} style={{flex:"0 0 auto"}}>
                <div style={{fontSize:11,fontWeight:700,color:c.tx,marginBottom:8,paddingLeft:2}}>
                  {monthNames[mo]} {yr}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,"+CELL+"px)",gap:GAP}}>
                  {cells}
                </div>
              </div>
            );
          })}
        </div>
      );})}

      {/* Legenda */}
      <div style={{display:"flex",gap:14,alignItems:"center",flexWrap:"wrap",marginTop:4,paddingTop:12,borderTop:"1px solid "+c.bd}}>
        <span style={{fontSize:10,color:c.txm,fontWeight:600}}>LEGENDA:</span>
        {[[-2,"Perdita forte"],[-0.5,"Perdita lieve"],[0.01,"Neutro"],[0.5,"Win lieve"],[2,"Win forte"]].map(function(e){return(
          <div key={e[0]} style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{width:18,height:18,borderRadius:4,background:getCellBg(e[0]),border:"1px solid "+c.bd}}/>
            <span style={{fontSize:10,color:c.txm}}>{e[1]}</span>
          </div>
        );})}
        <span style={{fontSize:10,color:c.txm,marginLeft:8,fontStyle:"italic"}}>Passa il mouse su un giorno per il dettaglio</span>
      </div>
    </div>
  );
}


// ── ANALYTICS ────────────────────────────────────────────────────────────────
function Analytics({c,trades,strategie,conti}){
  const [selConti,setSelConti]=useState([]);
  const [selStrat,setSelStrat]=useState([]);
  const [unit,setUnit]=useState("R");
  const [tab,setTab]=useState("panoramica");
  const [selSessione,setSelSessione]=useState([]);
  const [periodoA,setPeriodoA]=useState({from:"",to:""});
  const [periodoB,setPeriodoB]=useState({from:"",to:""});
  function toggleC(id){setSelConti(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  function toggleS(id){setSelStrat(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  function toggleSess(s){setSelSessione(function(p){return p.includes(s)?p.filter(function(x){return x!==s;}):[...p,s];});}
  function getSessione(iso){return getSessioneWithTz(iso);}
  const filtered=trades.filter(function(t){
    if(selConti.length>0&&!selConti.includes(t.conto_id)) return false;
    if(selStrat.length>0&&!selStrat.includes(t.strategia_id)) return false;
    if(selSessione.length>0&&!selSessione.includes(getSessione(t.data_apertura))) return false;
    return true;
  });
  // helper: filtra per periodo (usato nel tab Confronto)
  function filteredByPeriodo(p){
    return filtered.filter(function(t){
      if(p.from&&t.data_apertura&&t.data_apertura<p.from) return false;
      if(p.to&&t.data_apertura&&t.data_apertura>p.to+"T23:59:59") return false;
      return true;
    });
  }
  const totalPnl=filtered.reduce(function(s,t){return s+(t.pnl_eur||0);},0);
  const capMap=makeCapMap(conti);
  const totalPct=calcTotalPct(filtered,capMap);
  const pctPerTrade=filtered.length>0?(totalPct/filtered.length):0;
  const m=calcMetrics(filtered);
  const curve=buildEquityCurve(filtered,capMap);
  function fmtVal(r, pnlSingolo, pctSingolo){
    if(unit==="R") return fmtR(r);
    if(unit==="$"){const p=pnlSingolo!=null?pnlSingolo:totalPnl;return (p>=0?"+":"")+"$"+Math.abs(p).toFixed(0);}
    if(unit==="%"){const p=pctSingolo!=null?pctSingolo:totalPct;return fmtPct(p);}
    return fmtR(r);
  }
  function tradePct(t){const cap=capMap[t.conto_id]||0;return cap>0?((t.pnl_eur||0)/cap)*100:0;}
  const stratPerf=strategie.map(function(s){
    const st=filtered.filter(function(t){return t.strategia_id===s.id;});
    const sp=st.reduce(function(sum,t){return sum+(t.pnl_eur||0);},0);
    const spct=calcTotalPct(st,capMap);
    return {...s,...calcMetrics(st),_pnl:sp,_pct:spct};
  }).filter(function(s){return s.total>0;});
  const moods=["😌 Calmo","😐 Neutro","😰 Ansioso","😤 Frustrato","😵 Euforico","😴 Stanco"];
  const moodStats=moods.map(function(mood){
    const mt=filtered.filter(function(t){return t.mood===mood;});
    const mm=calcMetrics(mt);
    const mp=mt.reduce(function(s,t){return s+(t.pnl_eur||0);},0);
    return {mood,n:mt.length,wr:mm.wr,exp:mm.exp,pnl:mp};
  }).filter(function(x){return x.n>0;});
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <ModuleHeader
        title="Analytics"
        subtitle={filtered.length+" trade analizzati"}
        tooltip="Analytics è il cuore di EdgeLab: analizza tutti i tuoi trade reali e ti mostra dove stai guadagnando, dove stai perdendo, e perché. Tab Panoramica: metriche globali e equity curve del tuo periodo selezionato. Tab Calendario: vedi la tua performance giorno per giorno su una mappa visiva — verde guadagno, rosso perdita. Tab Confronto: metti a confronto due periodi diversi per vedere se stai migliorando. Tab Sessioni: analisi per London, NY e Asian con chart per giorno della settimana, ora UTC e durata dei trade. Tab Strategie: ranking delle tue strategie per capire quale ha il vero edge e quale invece pesa sul tuo P/L."
        c={c}
        right={
          <div style={{display:"flex",gap:2,background:c.tag,borderRadius:8,padding:2}}>
            {["R","$","%"].map(function(u){return(
              <button key={u} onClick={function(){setUnit(u);}} style={{padding:"4px 10px",borderRadius:6,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:unit===u?700:400,background:unit===u?c.ac:"transparent",color:unit===u?"#fff":c.txm}}>{u}</button>
            );})}
          </div>
        }
      />
      {/* FILTRI */}
      <div style={{padding:"8px 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:14,flexShrink:0,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:9,fontWeight:700,color:c.txm,marginRight:2}}>CONTO</span>
          {conti.map(function(cn){const s=selConti.includes(cn.id);return <button key={cn.id} onClick={function(){toggleC(cn.id);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+(s?c.ac:c.bd),background:s?c.ac+"15":"transparent",color:s?c.ac:c.txm,fontSize:11,fontWeight:s?700:400,cursor:"pointer",fontFamily:"inherit"}}>{cn.nome}</button>;})}
        </div>
        <div style={{width:1,background:c.bd,height:20}}/>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:9,fontWeight:700,color:c.txm,marginRight:2}}>STRATEGIA</span>
          {strategie.map(function(s){const sel=selStrat.includes(s.id);return <button key={s.id} onClick={function(){toggleS(s.id);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+(sel?c.ac:c.bd),background:sel?c.ac+"15":"transparent",color:sel?c.ac:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{s.nome}</button>;})}
        </div>
        <div style={{width:1,background:c.bd,height:20}}/>
        <div style={{display:"flex",gap:5,alignItems:"center"}}>
          <span style={{fontSize:9,fontWeight:700,color:c.txm,marginRight:2}}>SESSIONE</span>
          {["Asian","London","NY"].map(function(s){const sel=selSessione.includes(s);const col=s==="London"?"#4F46E5":s==="NY"?"#0F766E":"#D97706";return(
            <button key={s} onClick={function(){toggleSess(s);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+(sel?col:c.bd),background:sel?col+"20":"transparent",color:sel?col:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{s}</button>
          );})}
        </div>
        {(selConti.length>0||selStrat.length>0||selSessione.length>0)&&<button onClick={function(){setSelConti([]);setSelStrat([]);setSelSessione([]);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>✕ Reset</button>}
      </div>
      {/* TABS NAVIGAZIONE */}
      <div style={{padding:"0 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:0,flexShrink:0}}>
        {[["panoramica","📊 Panoramica"],["calendario","📅 Calendario"],["confronto","⟷ Confronto"],["sessioni","🌍 Sessioni"],["strategie","◈ Strategie"],["tags","🏷 Tag"],["psicologia","🧠 Psicologia"]].map(function(t){const active=tab===t[0];return(
          <button key={t[0]} onClick={function(){setTab(t[0]);}} style={{padding:"9px 16px",border:"none",borderBottom:active?"2px solid "+c.ac:"2px solid transparent",background:"transparent",color:active?c.ac:c.txm,fontSize:11,fontWeight:active?700:400,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",transition:"color 0.15s"}}>{t[1]}</button>
        );})}
      </div>
      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        <DisclaimerCampione n={filtered.length} c={c}/>
        {unit==="%"&&filtered.length>0&&filtered.filter(function(t){return t.pnl_eur!=null;}).length===0&&(
          <div style={{margin:"0 0 10px 0",padding:"9px 14px",borderRadius:9,background:c.rd+"10",border:"1px solid "+c.rd+"35",display:"flex",gap:9,alignItems:"flex-start"}}>
            <span style={{fontSize:14,flexShrink:0}}>⚠️</span>
            <div style={{fontSize:11,color:c.rd,lineHeight:1.65}}><strong>Dati monetari mancanti:</strong> per vedere la % reale compila il campo <strong>P/L in $</strong> su ogni trade. In alternativa usa la vista <strong>R</strong>.</div>
          </div>
        )}
        {filtered.length===0?(
          <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Nessun trade. Inserisci dei trade per vedere le analytics.</div>
        ):(
          <>
            {/* ── TAB: PANORAMICA ── */}
            {tab==="panoramica"&&(
              <>
                <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:12}}>
                  {(function(){
                    const ddCurve=curve.map(function(p){return p.pct;});
                    let peak=0,maxDDpct=0;
                    ddCurve.forEach(function(v){if(v>peak)peak=v;const dd=peak-v;if(dd>maxDDpct)maxDDpct=dd;});
                    maxDDpct=parseFloat(maxDDpct.toFixed(2));
                    const winTrades=filtered.filter(function(t){return t.r_result>0;});
                    const lossTrades=filtered.filter(function(t){return t.r_result<0;});
                    const avgWinPnl=winTrades.length>0?winTrades.reduce(function(s,t){return s+(t.pnl_eur||0);},0)/winTrades.length:0;
                    const avgLossPnl=lossTrades.length>0?Math.abs(lossTrades.reduce(function(s,t){return s+(t.pnl_eur||0);},0)/lossTrades.length):0;
                    const avgWinPct=winTrades.length>0?calcTotalPct(winTrades,capMap)/winTrades.length:0;
                    const avgLossPct=lossTrades.length>0?Math.abs(calcTotalPct(lossTrades,capMap))/lossTrades.length:0;
                    return [
                      {l:"P/L Totale",v:fmtVal(m.totalR,totalPnl,totalPct),col:m.totalR>=0?c.gr:c.rd,tt:"Risultato complessivo nel periodo e filtri selezionati. In R è la somma delle unità di rischio guadagnate o perse — la misura più oggettiva perché è indipendente dalla size. In € è il guadagno monetario reale. In % è il rendimento sul capitale del conto calcolato trade per trade."},
                      {l:"Win Rate",v:m.wr+"%",col:m.wr>=50?c.gr:c.rd,tt:"Percentuale dei trade chiusi in profitto. Importante: un win rate alto non garantisce profittabilità. Un trader con win rate 35% può guadagnare molto se i suoi profitti medi sono grandi rispetto alle perdite. Guarda sempre il win rate insieme all'expectancy per avere il quadro reale."},
                      {l:"Profit Factor",v:m.pf,col:m.pf>=1.5?c.gr:m.pf>=1?c.am:c.rd,tt:"Rapporto tra tutto quello che hai guadagnato e tutto quello che hai perso. Se è 2.0 guadagni il doppio di quello che perdi, in totale. Sopra 1.5 è un buon segnale. Sotto 1.0 la strategia perde più di quanto guadagna. È la sintesi più rapida per capire se il tuo trading ha un edge positivo."},
                      {l:"Expectancy",v:fmtVal(m.exp,totalPnl/Math.max(filtered.length,1),pctPerTrade),col:m.exp>=0?c.gr:c.rd,tt:"Quanto guadagni in media per ogni trade aperto, considerando sia vincite che perdite. Se positivo, la tua strategia è profittevole nel tempo — più trade fai, più guadagni. Se negativo, più trade fai, più perdi. È la metrica chiave per decidere se scalare la frequenza di trading."},
                      {l:"Max Drawdown",v:unit==="R"?"-"+m.maxDD+"R":unit==="%"?"-"+maxDDpct+"%":"-$"+avgLossPnl.toFixed(0),col:c.rd,tt:"La perdita cumulativa più grande che hai subito dal massimo del conto fino al minimo successivo. Ti dice qual è stato il momento più duro della tua equity. Un drawdown grande richiede una ripresa proporzionalmente ancora più grande: -25% richiede +33% per tornare al pari. Tienilo monitorato per capire i limiti reali della tua strategia."},
                      {l:"Avg Win / Loss",v:fmtVal(m.avgWin,avgWinPnl,avgWinPct)+" / "+fmtVal(m.avgLoss,avgLossPnl,avgLossPct),col:c.tx,tt:"Il risultato medio dei tuoi trade vincenti confrontato con quello dei perdenti. Il rapporto tra questi due numeri è il tuo R:R reale medio — quanto guadagni in media quando vinci rispetto a quanto perdi quando perdi. Se il tuo avg win è +2R e il tuo avg loss è -1R, il tuo R:R reale è 2:1. Combinato con il win rate, determina completamente la tua profittabilità a lungo termine."},
                    ];
                  })().map(function(mm,i){return(
                    <div key={i} style={{background:c.card,borderRadius:10,padding:"10px 12px",border:"1px solid "+c.bd}}>
                      <div style={{fontSize:8,color:c.txm,fontWeight:600,letterSpacing:"0.05em",marginBottom:4,display:"flex",alignItems:"center",gap:2}}>{mm.l.toUpperCase()}<Tooltip text={mm.tt} c={c}/></div>
                      <div style={{fontSize:14,fontWeight:700,color:mm.col,letterSpacing:"-0.02em",lineHeight:1}}>{mm.v}</div>
                    </div>
                  );})}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1.4fr 1fr",gap:10,marginBottom:10}}>
                  <div style={{background:c.card,borderRadius:12,padding:"13px 15px",border:"1px solid "+c.bd}}>
                    <div style={{fontSize:12,fontWeight:700,marginBottom:10,display:"flex",alignItems:"center",gap:4}}>Equity Curve<Tooltip c={c} text="Mostra come cresce (o scende) il tuo capitale trade dopo trade. Una curva che sale costantemente verso destra indica una strategia solida. Picchi e valli brusche indicano alta volatilità dei risultati. Il drawdown è la distanza dal massimo raggiunto fino al punto più basso successivo — più è profondo, più è difficile psicologicamente e finanziariamente da sostenere."/></div>
                    <EqChartSVG curve={curve} c={c} h={110} unit={unit}/>
                  </div>
                  <div style={{background:c.card,borderRadius:12,padding:"13px 15px",border:"1px solid "+c.bd}}>
                    <div style={{fontSize:12,fontWeight:700,marginBottom:10,display:"flex",alignItems:"center",gap:4}}>Win / Loss / BE<Tooltip c={c} text="Distribuzione dei tuoi trade: vincenti (Win), perdenti (Loss) e in pareggio (BE = Break Even). Il win rate da solo non basta per giudicare una strategia — puoi guadagnare anche con un win rate del 40% se i tuoi profitti medi sono grandi rispetto alle perdite medie. Guarda sempre il win rate insieme all'expectancy e al profit factor."/></div>
                    {[{l:"✓ Win",n:m.wins,col:c.gr,w:m.wr+"%"},{l:"✗ Loss",n:m.losses,col:c.rd,w:Math.round(m.losses/Math.max(m.total,1)*100)+"%"},{l:"— BE",n:m.be,col:c.txm,w:Math.round(m.be/Math.max(m.total,1)*100)+"%"}].map(function(r,i){return(
                      <div key={i} style={{marginBottom:8}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:11,fontWeight:600,color:r.col}}>{r.l} ({r.n})</span><span style={{fontSize:10,color:c.txm}}>{r.w}</span></div>
                        <div style={{height:5,borderRadius:3,background:c.bd}}><div style={{height:"100%",width:r.w,background:r.col,borderRadius:3,opacity:0.8}}/></div>
                      </div>
                    );})}
                    <div style={{marginTop:10,padding:"8px 10px",borderRadius:8,background:c.bg}}>
                      <div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:2}}>STREAK</div>
                      <div style={{display:"flex",gap:12}}>
                        <span style={{fontSize:11,color:c.gr}}>Max Win: {m.streak.maxW}</span>
                        <span style={{fontSize:11,color:c.rd}}>Max Loss: {m.streak.maxL}</span>
                      </div>
                    </div>
                  </div>
                </div>
                {moodStats.length>0&&(
                  <div style={{background:c.card,borderRadius:12,padding:"13px 15px",border:"1px solid "+c.bd}}>
                    <div style={{fontSize:12,fontWeight:700,marginBottom:10,display:"flex",alignItems:"center",gap:4}}>Stato Mentale vs Risultati<Tooltip c={c} text="Confronta le tue performance in base a come ti sentivi prima di entrare in trade. Se quando sei ansioso o frustrato i risultati peggiorano sensibilmente, è un segnale chiaro che il tuo stato emotivo influenza le tue decisioni. Usa questa sezione per capire in quale condizione mentale sei più lucido e disciplinato, e considera di saltare il trading nei giorni negativi."/></div>
                    {moodStats.map(function(x,i){return(
                      <div key={i} style={{marginBottom:i<moodStats.length-1?8:0}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:11,fontWeight:600}}>{x.mood}</span><div style={{display:"flex",gap:10}}><span style={{fontSize:11,fontWeight:700,color:x.wr>=50?c.gr:c.rd}}>WR {x.wr}%</span><span style={{fontSize:11,fontWeight:700,color:x.exp>=0?c.gr:c.rd}}>{fmtVal(x.exp)}</span><span style={{fontSize:10,color:c.txm}}>{x.n} trade</span></div></div>
                        <div style={{height:4,borderRadius:3,background:c.bd}}><div style={{height:"100%",width:x.wr+"%",background:x.wr>=60?c.gr:x.wr>=40?c.am:c.rd,borderRadius:3}}/></div>
                      </div>
                    );})}
                  </div>
                )}

                {/* ── DISTRIBUZIONE R ── */}
                {(function(){
                  const rBuckets={};
                  filtered.forEach(function(t){
                    if(t.r_result==null) return;
                    const bucket=parseFloat((Math.floor(t.r_result*2)/2).toFixed(1));
                    if(!rBuckets[bucket]) rBuckets[bucket]={r:bucket,n:0,wins:0};
                    rBuckets[bucket].n++;
                    if(t.r_result>0) rBuckets[bucket].wins++;
                  });
                  const buckets=Object.values(rBuckets).sort(function(a,b){return a.r-b.r;});
                  if(buckets.length<2) return null;
                  const maxN=Math.max(...buckets.map(function(b){return b.n;}));
                  return(
                    <div style={{background:c.card,borderRadius:12,padding:"13px 15px",border:"1px solid "+c.bd}}>
                      <div style={{fontSize:12,fontWeight:700,marginBottom:4,display:"flex",alignItems:"center",gap:4}}>
                        Distribuzione R
                        <Tooltip c={c} text="Istogramma dei risultati in R. Ogni barra rappresenta un bucket di 0.5R. Verde = trade in profitto, rosso = in perdita. Una buona distribuzione ha la coda destra (win grandi) più alta della coda sinistra (loss)."/>
                      </div>
                      <div style={{fontSize:10,color:c.txm,marginBottom:12}}>Ogni barra = 0.5R. Verde = win, Rosso = loss.</div>
                      <div style={{display:"flex",alignItems:"flex-end",gap:3,height:80,paddingBottom:4}}>
                        {buckets.map(function(b,i){
                          const pct=maxN>0?(b.n/maxN)*100:0;
                          const isWin=b.r>0;
                          const isBE=b.r===0;
                          const col=isBE?c.am:isWin?c.gr:c.rd;
                          return(
                            <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2,cursor:"default"}} title={b.r+"R: "+b.n+" trade"}>
                              <div style={{width:"100%",height:Math.max(pct*0.72,2)+"px",background:col,borderRadius:"3px 3px 0 0",opacity:0.85}}/>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",paddingTop:4,borderTop:"1px solid "+c.bdl}}>
                        <span style={{fontSize:9,color:c.rd,fontWeight:600}}>{buckets[0]?.r}R</span>
                        <span style={{fontSize:9,color:c.txm}}>0R</span>
                        <span style={{fontSize:9,color:c.gr,fontWeight:600}}>{buckets[buckets.length-1]?.r}R</span>
                      </div>
                      <div style={{marginTop:10,display:"flex",gap:8,flexWrap:"wrap"}}>
                        {buckets.map(function(b,i){return(
                          <div key={i} style={{fontSize:9,color:b.r>0?c.gr:b.r<0?c.rd:c.am,background:(b.r>0?c.gr:b.r<0?c.rd:c.am)+"12",borderRadius:5,padding:"2px 6px",fontWeight:600}}>
                            {b.r>0?"+":""}{b.r}R: {b.n}
                          </div>
                        );})}
                      </div>
                    </div>
                  );
                })()}

                {/* ── MAE / MFE ── */}
                {(function(){
                  const withMfe=filtered.filter(function(t){return t.mfe!=null;});
                  const withMae=[];// MAE rimosso
                  if(withMfe.length<2&&withMae.length<2) return null;
                  const mfeRArr=withMfe.map(function(t){
                    return parseFloat(t.mfe);
                  }).filter(function(v){return v!=null;});
                  const maeRArr=withMae.map(function(t){
                    return 0;// MAE rimosso
                  }).filter(function(v){return v!=null;});
                  const avgMfe=mfeRArr.length>0?parseFloat((mfeRArr.reduce(function(a,b){return a+b;},0)/mfeRArr.length).toFixed(2)):null;
                  const avgMae=maeRArr.length>0?parseFloat((maeRArr.reduce(function(a,b){return a+b;},0)/maeRArr.length).toFixed(2)):null;
                  const avgExit=parseFloat((m.exp||0).toFixed(2));
                  const wasted=avgMfe!=null?parseFloat((avgMfe-Math.max(avgExit,0)).toFixed(2)):null;
                  const reached2R=mfeRArr.filter(function(v){return v>=2;}).length;
                  const lostAfter2R=withMfe.filter(function(t){
                    const mfeR=parseFloat(t.mfe)||0;
                    return mfeR>=2&&t.r_result<0;
                  }).length;
                  return(
                    <div style={{background:c.card,borderRadius:12,padding:"13px 15px",border:"1px solid "+c.bd}}>
                      <div style={{fontSize:12,fontWeight:700,marginBottom:4,display:"flex",alignItems:"center",gap:4}}>
                        MAE / MFE in R
                        <Tooltip c={c} text="MAE (Maximum Adverse Excursion) = quanto va contro di te prima che il trade si chiuda. MFE (Maximum Favorable Excursion) = quanto va a tuo favore prima di tornare indietro. Confrontare MFE con la tua uscita reale ti dice quant'R stai lasciando sul tavolo ogni trade."/>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:12}}>
                        {[
                          {l:"MFE Medio",v:avgMfe!=null?"+"+avgMfe+"R":"—",col:c.gr,sub:withMfe.length+" trade con MFE",tt:"Il Maximum Favourable Excursion medio — quanto il prezzo si muove IN TUO FAVORE in media prima che tu chiuda il trade. Se il tuo MFE medio è 3R ma esci a 2R, stai lasciando 1R per trade sul tavolo. Più questo numero supera il tuo TP medio, più hai margine per ottimizzare le uscite."},
                          {l:"Uscita Media",v:fmtVal(avgExit),col:avgExit>=0?c.gr:c.rd,sub:"expectancy attuale"},
                          {l:"R sul Tavolo",v:wasted!=null&&wasted>0?"-"+wasted+"R":"—",col:wasted>0.3?c.am:c.gr,sub:"MFE medio - uscita media",tt:"Quanti R stai lasciando sul tavolo in media per trade. Calcolato come: MFE medio meno uscita media reale. Se il prezzo raggiunge +3R ma tu esci a +2R, lasci 1R per trade. Anche un piccolo miglioramento moltiplicato per centinaia di trade cambia drasticamente il risultato annuale."},
                        ].map(function(kpi,i){return(
                          <div key={i} style={{background:c.bg,borderRadius:9,padding:"10px 12px",textAlign:"center"}}>
                            <div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:3}}>{kpi.l}</div>
                            <div style={{fontSize:15,fontWeight:800,color:kpi.col}}>{kpi.v}</div>
                            <div style={{fontSize:9,color:c.txm,marginTop:2}}>{kpi.sub}</div>
                          </div>
                        );})}
                      </div>
                      {avgMae!=null&&(
                        <div style={{fontSize:11,color:c.txm,marginBottom:8}}>
                          MAE medio: <strong style={{color:c.rd}}>-{avgMae}R</strong> — quanto va contro di te in media prima dell'uscita.
                        </div>
                      )}
                      {reached2R>0&&(
                        <div style={{fontSize:11,padding:"8px 12px",borderRadius:8,background:c.am+"12",border:"1px solid "+c.am+"30",color:c.tx}}>
                          ⚠ {reached2R} trade arrivano a +2R MFE — di questi, <strong>{lostAfter2R}</strong> finiscono in loss ({Math.round(lostAfter2R/reached2R*100)}%). Considera un TP a 2R o parziale.
                        </div>
                      )}
                      {wasted!=null&&wasted>0.4&&(
                        <div style={{fontSize:11,padding:"8px 12px",borderRadius:8,background:c.rd+"10",border:"1px solid "+c.rd+"25",color:c.tx,marginTop:8}}>
                          📊 Lasci in media <strong>{wasted}R</strong> per trade sul tavolo. Il tuo MFE medio è +{avgMfe}R ma esci a {fmtVal(avgExit)} — c'è spazio per migliorare il TP.
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            )}

            {/* ── TAB: CALENDARIO ── */}
            {tab==="calendario"&&(
              <div style={{background:c.card,borderRadius:12,padding:"16px",border:"1px solid "+c.bd}}>
                <div style={{fontSize:12,fontWeight:700,marginBottom:4,display:"flex",alignItems:"center",gap:4}}>Heatmap Calendario — Performance giornaliera<Tooltip c={c} text="Ogni cella è un giorno di trading. Il colore indica il risultato complessivo di quel giorno: verde intenso = giornata molto profittevole, rosso intenso = giornata molto negativa. Cerca pattern visivi: hai giornate rosse concentrate in certi periodi del mese? Certi mesi vanno sistematicamente male? Queste informazioni ti aiutano a capire quando sei più in forma e quando dovresti ridurre la frequenza o la size."/></div>
                <div style={{fontSize:10,color:c.txm,marginBottom:14}}>Ogni cella = un giorno. Verde = profitto, Rosso = perdita. Passa sopra per il dettaglio.</div>
                <CalHeatmap trades={filtered} c={c}/>
              </div>
            )}

            {/* ── TAB: CONFRONTO PERIODI ── */}
            {tab==="confronto"&&(function(){
              const tA=filteredByPeriodo(periodoA);
              const tB=filteredByPeriodo(periodoB);
              const mA=calcMetrics(tA); const mB=calcMetrics(tB);
              const pnlA=tA.reduce(function(s,t){return s+(t.pnl_eur||0);},0);
              const pnlB=tB.reduce(function(s,t){return s+(t.pnl_eur||0);},0);
              const pctA=calcTotalPct(tA,capMap); const pctB=calcTotalPct(tB,capMap);
              const crvA=buildEquityCurve(tA,capMap); const crvB=buildEquityCurve(tB,capMap);
              function fvA(r,p,pct){if(unit==="R")return fmtR(r);if(unit==="$")return (p>=0?"+":"")+"$"+Math.abs(p).toFixed(0);return fmtPct(pct);}
              const metrics=[
                {l:"Trade",a:mA.total,b:mB.total,better:"higher"},
                {l:"Win Rate",a:mA.wr+"%",b:mB.wr+"%",better:"higher",av:mA.wr,bv:mB.wr},
                {l:"Profit Factor",a:mA.pf,b:mB.pf,better:"higher",av:parseFloat(mA.pf),bv:parseFloat(mB.pf)},
                {l:"Expectancy",a:fvA(mA.exp,pnlA/Math.max(tA.length,1),pctA/Math.max(tA.length,1)),b:fvA(mB.exp,pnlB/Math.max(tB.length,1),pctB/Math.max(tB.length,1)),better:"higher",av:mA.exp,bv:mB.exp},
                {l:"P/L",a:fvA(mA.totalR,pnlA,pctA),b:fvA(mB.totalR,pnlB,pctB),better:"higher",av:mA.totalR,bv:mB.totalR},
                {l:"Max DD",a:"-"+mA.maxDD+"R",b:"-"+mB.maxDD+"R",better:"lower",av:mA.maxDD,bv:mB.maxDD},
              ];
              return(
                <>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                    {[{label:"Periodo A",p:periodoA,setP:setPeriodoA,col:"#4F46E5"},{label:"Periodo B",p:periodoB,setP:setPeriodoB,col:"#0F766E"}].map(function(pd){return(
                      <div key={pd.label} style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"2px solid "+pd.col+"40"}}>
                        <div style={{fontSize:11,fontWeight:700,color:pd.col,marginBottom:10}}>{pd.label}</div>
                        <div style={{display:"flex",gap:8}}>
                          <div style={{flex:1}}><div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:4}}>DA</div><input type="date" value={pd.p.from} onChange={function(e){pd.setP(function(p){return {...p,from:e.target.value};});}} style={{width:"100%",padding:"7px 9px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
                          <div style={{flex:1}}><div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:4}}>A</div><input type="date" value={pd.p.to} onChange={function(e){pd.setP(function(p){return {...p,to:e.target.value};});}} style={{width:"100%",padding:"7px 9px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
                        </div>
                      </div>
                    );})}
                  </div>
                  <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
                    <div style={{fontSize:11,fontWeight:700,marginBottom:10}}>Confronto Metriche</div>
                    <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:0}}>
                      <div style={{fontSize:9,fontWeight:700,color:c.txm,padding:"6px 0",borderBottom:"1px solid "+c.bd}}>METRICA</div>
                      <div style={{fontSize:9,fontWeight:700,color:"#4F46E5",padding:"6px 0",borderBottom:"1px solid "+c.bd,textAlign:"center"}}>PERIODO A</div>
                      <div style={{fontSize:9,fontWeight:700,color:"#0F766E",padding:"6px 0",borderBottom:"1px solid "+c.bd,textAlign:"center"}}>PERIODO B</div>
                      {metrics.map(function(mm,i){
                        const winner=mm.av!=null&&mm.bv!=null?(mm.better==="higher"?mm.av>mm.bv?0:mm.bv>mm.av?1:-1:mm.av<mm.bv?0:mm.bv<mm.av?1:-1):-1;
                        return[
                          <div key={"l"+i} style={{fontSize:11,fontWeight:600,padding:"8px 0",borderBottom:"1px solid "+c.bd+"80"}}>{mm.l}</div>,
                          <div key={"a"+i} style={{fontSize:12,fontWeight:700,padding:"8px 0",borderBottom:"1px solid "+c.bd+"80",textAlign:"center",color:winner===0?c.gr:c.tx,background:winner===0?"#4F46E508":"transparent"}}>{mm.a}</div>,
                          <div key={"b"+i} style={{fontSize:12,fontWeight:700,padding:"8px 0",borderBottom:"1px solid "+c.bd+"80",textAlign:"center",color:winner===1?c.gr:c.tx,background:winner===1?"#0F766E08":"transparent"}}>{mm.b}</div>,
                        ];
                      })}
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                    {[{label:"Periodo A",crv:crvA,col:"#4F46E5"},{label:"Periodo B",crv:crvB,col:"#0F766E"}].map(function(pd){return(
                      <div key={pd.label} style={{background:c.card,borderRadius:11,padding:"12px 14px",border:"1px solid "+c.bd}}>
                        <div style={{fontSize:11,fontWeight:700,color:pd.col,marginBottom:8}}>{pd.label} — Equity Curve</div>
                        <EqChartSVG curve={pd.crv} c={c} h={90} unit={unit}/>
                      </div>
                    );})}
                  </div>
                </>
              );
            })()}

            {/* ── TAB: SESSIONI ── */}
            {tab==="sessioni"&&(function(){
              const sessions=["Asian","London","NY"];
              const sessData=sessions.map(function(s){
                const st=filtered.filter(function(t){return getSessione(t.data_apertura)===s;});
                const sm=calcMetrics(st);
                const sp=st.reduce(function(sum,t){return sum+(t.pnl_eur||0);},0);
                const spct=calcTotalPct(st,capMap);
                return {s,n:st.length,wr:sm.wr,exp:sm.exp,pf:sm.pf,totalR:sm.totalR,pnl:sp,pct:spct};
              });

              // ── GIORNI SETTIMANA ──
              const dayNames=["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
              const dayData=dayNames.map(function(d,i){
                const dt=filtered.filter(function(t){return t.data_apertura&&new Date(t.data_apertura).getDay()===i;});
                const dm=calcMetrics(dt);
                const dp=dt.reduce(function(s,t){return s+(t.pnl_eur||0);},0);
                // durata media in minuti
                const durArr=dt.filter(function(t){return t.data_apertura&&t.data_chiusura;}).map(function(t){return (new Date(t.data_chiusura)-new Date(t.data_apertura))/60000;});
                const avgDur=durArr.length>0?Math.round(durArr.reduce(function(s,v){return s+v;},0)/durArr.length):0;
                return {d,i,n:dt.length,wr:dm.wr,exp:dm.exp,pnl:dp,avgDur};
              }).filter(function(d){return d.n>0;});

              // ── ORE UTC ──
              const hourData=Array.from({length:24},function(_,h){
                const ht=filtered.filter(function(t){return t.data_apertura&&getHourWithTz(t.data_apertura)===h;});
                const hm=calcMetrics(ht);
                const durArr=ht.filter(function(t){return t.data_apertura&&t.data_chiusura;}).map(function(t){return (new Date(t.data_chiusura)-new Date(t.data_apertura))/60000;});
                const avgDur=durArr.length>0?Math.round(durArr.reduce(function(s,v){return s+v;},0)/durArr.length):0;
                return {h,n:ht.length,exp:hm.exp,wr:hm.wr,avgDur};
              });

              // ── DURATA GLOBALE ──
              const durAll=filtered.filter(function(t){return t.data_apertura&&t.data_chiusura;}).map(function(t){
                return {dur:(new Date(t.data_chiusura)-new Date(t.data_apertura))/60000, r:t.r_result||0};
              });
              const avgDurAll=durAll.length>0?Math.round(durAll.reduce(function(s,d){return s+d.dur;},0)/durAll.length):0;
              const avgDurWin=durAll.filter(function(d){return d.r>0;}).length>0?Math.round(durAll.filter(function(d){return d.r>0;}).reduce(function(s,d){return s+d.dur;},0)/durAll.filter(function(d){return d.r>0;}).length):0;
              const avgDurLoss=durAll.filter(function(d){return d.r<0;}).length>0?Math.round(durAll.filter(function(d){return d.r<0;}).reduce(function(s,d){return s+d.dur;},0)/durAll.filter(function(d){return d.r<0;}).length):0;
              function fmtDur(min){if(min<=0)return "—";if(min<60)return min+"min";return Math.floor(min/60)+"h "+(min%60)+"m";}

              // max per scale chart
              const maxWR=Math.max.apply(null,dayData.map(function(d){return d.wr;}));
              const maxExpDay=Math.max.apply(null,dayData.map(function(d){return Math.abs(d.exp);})||[1]);
              const maxExpHour=Math.max.apply(null,hourData.map(function(h){return Math.abs(h.exp);})||[1]);
              const maxN=Math.max.apply(null,hourData.map(function(h){return h.n;})||[1]);

              // helper chart bar generico
              function BarChart({data,keyFn,nameFn,metricFn,metricLabel,colorFn,fmtFn,height,showN}){
                const maxVal=Math.max.apply(null,data.map(metricFn).map(Math.abs))||1;
                return(
                  <div style={{display:"flex",gap:6,alignItems:"flex-end",height:height||100}}>
                    {data.map(function(d,i){
                      const val=metricFn(d);
                      const absVal=Math.abs(val);
                      const pct=absVal/maxVal;
                      const col=colorFn(d,val);
                      const barH=Math.max(pct*(height||100)*0.75, d.n>0||absVal>0?3:0);
                      return(
                        <div key={keyFn(d)} title={nameFn(d)+" — "+metricLabel+": "+(fmtFn?fmtFn(val):val)+(showN?" ("+d.n+" trade)":"")} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:"default"}}>
                          <div style={{fontSize:8,fontWeight:700,color:col,opacity:absVal>0?1:0}}>{fmtFn?fmtFn(val):val}</div>
                          <div style={{width:"100%",flex:1,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
                            <div style={{width:"100%",height:barH,background:col,borderRadius:"4px 4px 0 0",opacity:d.n>0?0.82:0.2}}/>
                          </div>
                          <div style={{fontSize:9,fontWeight:600,color:c.txm,textAlign:"center",whiteSpace:"nowrap"}}>{nameFn(d)}</div>
                          {showN&&d.n>0&&<div style={{fontSize:7,color:c.txm}}>{d.n}t</div>}
                        </div>
                      );
                    })}
                  </div>
                );
              }

              return(
                <>
                  {/* Box sessioni */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
                    {sessData.map(function(sd){const col=sd.s==="London"?"#4F46E5":sd.s==="NY"?"#0F766E":"#D97706";return(
                      <div key={sd.s} style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"2px solid "+col+"30"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                          <div style={{fontSize:13,fontWeight:700,color:col}}>{sd.s}</div>
                          <div style={{fontSize:10,color:c.txm}}>{sd.n} trade</div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
                          {[{l:"Win Rate",v:sd.wr+"%",col:sd.wr>=50?c.gr:c.rd},{l:"PF",v:sd.pf,col:parseFloat(sd.pf)>=1.5?c.gr:parseFloat(sd.pf)>=1?c.am:c.rd},{l:"Expectancy",v:fmtR(sd.exp),col:sd.exp>=0?c.gr:c.rd},{l:"P/L",v:fmtVal(sd.totalR,sd.pnl,sd.pct),col:sd.totalR>=0?c.gr:c.rd}].map(function(mm,i){return(
                            <div key={i} style={{background:c.bg,borderRadius:7,padding:"6px 8px"}}>
                              <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:1}}>{mm.l}</div>
                              <div style={{fontSize:11,fontWeight:700,color:mm.col}}>{mm.v}</div>
                            </div>
                          );})}
                        </div>
                      </div>
                    );})}
                  </div>

                  {/* ── CHART 1: Giorni settimana per WR ── */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                    <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd}}>
                      <div style={{fontSize:11,fontWeight:700,marginBottom:2,display:"flex",alignItems:"center",gap:4}}>📅 Win Rate per Giorno<Tooltip c={c} text="Mostra in quale giorno della settimana riesci a chiudere in profitto più trade. Un win rate alto in un giorno specifico può dipendere da molti fattori: liquidità del mercato, notizie economiche ricorrenti, o semplicemente la tua routine e concentrazione mentale in quel giorno. Se un giorno ha pochissimi trade non è statisticamente significativo — osserva solo i giorni con almeno 10-15 trade."/></div>
                      <div style={{fontSize:9,color:c.txm,marginBottom:12}}>Quale giorno hai la % di trade vincenti più alta</div>
                      {dayData.length===0?<div style={{textAlign:"center",padding:"20px",color:c.txm,fontSize:11}}>Dati insufficienti</div>:(
                        <BarChart
                          data={dayData}
                          keyFn={function(d){return d.d;}}
                          nameFn={function(d){return d.d;}}
                          metricFn={function(d){return d.wr;}}
                          metricLabel="WR"
                          colorFn={function(d,v){return v>=60?c.gr:v>=40?c.am:c.rd;}}
                          fmtFn={function(v){return v+"%";}}
                          height={110}
                          showN={true}
                        />
                      )}
                    </div>
                    <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd}}>
                      <div style={{fontSize:11,fontWeight:700,marginBottom:2,display:"flex",alignItems:"center",gap:4}}>💰 Expectancy per Giorno<Tooltip c={c} text="A differenza del win rate, l'expectancy per giorno ti dice quanto guadagni IN MEDIA per ogni trade fatto in quel giorno, tenendo conto sia delle vincite che delle perdite. Un giorno con win rate del 70% ma expectancy bassa significa che vinci spesso ma poco. Un giorno con win rate del 45% ma alta expectancy significa che quando vinci vinci grande. L'expectancy è la misura più completa della qualità di un giorno di trading."/></div>
                      <div style={{fontSize:9,color:c.txm,marginBottom:12}}>Quanto guadagni in media per ogni trade in quel giorno</div>
                      {dayData.length===0?<div style={{textAlign:"center",padding:"20px",color:c.txm,fontSize:11}}>Dati insufficienti</div>:(
                        <BarChart
                          data={dayData}
                          keyFn={function(d){return d.d;}}
                          nameFn={function(d){return d.d;}}
                          metricFn={function(d){return d.exp;}}
                          metricLabel="Exp"
                          colorFn={function(d,v){return v>0?c.gr:v<0?c.rd:c.bd;}}
                          fmtFn={function(v){return fmtR(v);}}
                          height={110}
                          showN={true}
                        />
                      )}
                    </div>
                  </div>

                  {/* ── CHART 2: Ore UTC per WR e Expectancy ── */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                    <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd}}>
                      <div style={{fontSize:11,fontWeight:700,marginBottom:2,display:"flex",alignItems:"center",gap:4}}>🕐 Win Rate per Ora (UTC)<Tooltip c={c} text="Mostra in quale fascia oraria (in UTC) riesci a chiudere in profitto più trade. La linea colorata sul bordo superiore indica la sessione di mercato: arancio = Asian (00-07), blu = London (08-12), verde = NY (13-21). Ore con barre alte e verdi sono le tue ore più produttive. Ore rosse con molti trade sono campanelli d'allarme — potresti continuare a operare in fasce orarie che storicamente ti danneggiano."/></div>
                      <div style={{fontSize:9,color:c.txm,marginBottom:12}}>Ore con più trade vincenti — hover per dettaglio</div>
                      <div style={{display:"flex",gap:3,alignItems:"flex-end",height:90}}>
                        {hourData.map(function(hd){
                          const col=hd.n===0?c.bd:hd.wr>=60?c.gr:hd.wr>=40?c.am:c.rd;
                          const pct=hd.n>0?hd.wr/100:0;
                          const sessCol=hd.h<8?"#D97706":hd.h<13?"#4F46E5":hd.h<22?"#0F766E":c.bd;
                          return(
                            <div key={hd.h} title={hd.h+":00 UTC — "+hd.n+" trade, WR "+hd.wr+"%"} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                              <div style={{width:"100%",height:Math.max(pct*70,hd.n>0?3:0),background:hd.n>0?col:c.bd+"40",borderRadius:"3px 3px 0 0",opacity:hd.n>0?0.85:0.25,borderTop:hd.n>0?"2px solid "+sessCol:"none"}}/>
                              <div style={{fontSize:6,color:c.txm}}>{hd.h}</div>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{display:"flex",gap:10,marginTop:6}}>
                        {[{col:"#D97706",l:"Asian"},{col:"#4F46E5",l:"London"},{col:"#0F766E",l:"NY"}].map(function(s){return(
                          <div key={s.l} style={{display:"flex",gap:3,alignItems:"center"}}><div style={{width:8,height:8,borderRadius:1,background:s.col}}/><span style={{fontSize:8,color:c.txm}}>{s.l}</span></div>
                        );})}
                        <span style={{fontSize:8,color:c.txm,marginLeft:4}}>· Linea top = sessione</span>
                      </div>
                    </div>
                    <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd}}>
                      <div style={{fontSize:11,fontWeight:700,marginBottom:2,display:"flex",alignItems:"center",gap:4}}>💰 Expectancy per Ora (UTC)<Tooltip c={c} text="Indica il guadagno medio per trade in ogni fascia oraria. Le barre verdi sono le ore dove in media guadagni ogni volta che apri un trade. Le barre rosse sono ore dove in media perdi — anche se a volte vinci, il risultato complessivo è negativo. Questa analisi è particolarmente utile per decidere un orario di stop: smettere di tradare dopo le 16:00 UTC se quella fascia è sistematicamente rossa per te."/></div>
                      <div style={{fontSize:9,color:c.txm,marginBottom:12}}>Verde = ora profittevole, Rosso = ora da evitare</div>
                      <div style={{display:"flex",gap:3,alignItems:"flex-end",height:90}}>
                        {hourData.map(function(hd){
                          const maxE=Math.max.apply(null,hourData.map(function(h){return Math.abs(h.exp);})||[1]);
                          const pct=maxE>0?Math.abs(hd.exp)/maxE:0;
                          const col=hd.exp>0?c.gr:hd.exp<0?c.rd:c.bd;
                          return(
                            <div key={hd.h} title={hd.h+":00 UTC — Exp "+hd.exp+"R, "+hd.n+" trade"} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                              <div style={{width:"100%",height:Math.max(pct*70,hd.n>0?3:0),background:hd.n>0?col:c.bd+"40",borderRadius:"3px 3px 0 0",opacity:hd.n>0?0.85:0.25}}/>
                              <div style={{fontSize:6,color:c.txm}}>{hd.h}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* ── CHART 3: Durata Media Trade ── */}
                  <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd}}>
                    <div style={{fontSize:11,fontWeight:700,marginBottom:2,display:"flex",alignItems:"center",gap:4}}>⏱ Durata Media Trade<Tooltip c={c} text="Quanto tempo rimangono aperti i tuoi trade in media. Il confronto tra durata dei trade vincenti e perdenti è molto rivelatore: se i loss durano molto più dei win, significa che tendi a tenere aperte le posizioni in perdita sperando in un recupero — un comportamento molto comune ma dannoso. Il pattern ideale è il contrario: win lunghi (lasci correre) e loss corti (tagli veloce). La durata per giorno ti aiuta a capire se certi giorni tendi a fare overtrade o a restare troppo esposto."/></div>
                    <div style={{fontSize:9,color:c.txm,marginBottom:14}}>Quanto durano i tuoi trade — confronto tra win e loss e per giorno della settimana</div>
                    {durAll.length===0?(
                      <div style={{textAlign:"center",padding:"20px",color:c.txm,fontSize:11}}>Nessun dato di durata — assicurati che i trade abbiano data di chiusura.</div>
                    ):(
                      <>
                        {/* Summary durata globale */}
                        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:16}}>
                          {[
                            {l:"Durata Media",v:fmtDur(avgDurAll),sub:"tutti i trade",col:c.tx,tt:"Quanto dura in media un tuo trade dall'apertura alla chiusura. Confrontalo con durata media dei trade vincenti vs perdenti — se i perdenti durano molto più dei vincenti potrebbe indicare che tieni troppo a lungo le posizioni in perdita sperando nel recupero."},
                            {l:"Durata Win",v:fmtDur(avgDurWin),sub:"trade vincenti",col:c.gr,tt:"La durata media dei soli trade vincenti. Se i tuoi trade vincenti sono molto più brevi di quelli perdenti, è spesso un segnale che prendi profitto troppo presto (fear of profit) e tieni le perdite troppo a lungo (hope trade)."},
                            {l:"Durata Loss",v:fmtDur(avgDurLoss),sub:"trade perdenti",col:c.rd,tt:"La durata media dei soli trade perdenti. Un valore molto più alto della durata dei trade vincenti è un segnale classico di asimmetria psicologica: si chiude il profitto in fretta e si aspetta che le perdite si riprendano. Questo comportamento distrugge il R:R reale nel tempo."},
                          ].map(function(box,i){return(
                            <div key={i} style={{background:c.bg,borderRadius:9,padding:"10px 12px",border:"1px solid "+c.bd}}>
                              <div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:4}}>{box.l}</div>
                              <div style={{fontSize:16,fontWeight:700,color:box.col,marginBottom:2}}>{box.v}</div>
                              <div style={{fontSize:9,color:c.txm}}>{box.sub}</div>
                            </div>
                          );})}
                        </div>
                        {/* Bar durata per giorno */}
                        {dayData.filter(function(d){return d.avgDur>0;}).length>0&&(
                          <>
                            <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:8}}>DURATA MEDIA PER GIORNO</div>
                            <BarChart
                              data={dayData.filter(function(d){return d.avgDur>0;})}
                              keyFn={function(d){return d.d;}}
                              nameFn={function(d){return d.d;}}
                              metricFn={function(d){return d.avgDur;}}
                              metricLabel="Durata"
                              colorFn={function(d,v){
                                // colore relativo alla durata media globale
                                if(avgDurAll===0) return c.ac;
                                return v>avgDurAll*1.3?c.am:v<avgDurAll*0.7?c.ac:c.gr;
                              }}
                              fmtFn={fmtDur}
                              height={90}
                              showN={false}
                            />
                            <div style={{fontSize:9,color:c.txm,marginTop:8,fontStyle:"italic"}}>
                              🟢 Vicino alla media · 🟡 Molto più lungo della media · 🔵 Molto più corto
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </>
              );
            })()}

            {/* ── TAB: STRATEGIE ── */}
            {tab==="strategie"&&(function(){
              const ranked=[...stratPerf].sort(function(a,b){return b.exp-a.exp;});
              const best=ranked[0];
              return(
                <>
                  {best&&(
                    <div style={{background:c.ac+"0D",borderRadius:11,padding:"12px 15px",border:"1px solid "+c.ac+"30",marginBottom:12,display:"flex",gap:12,alignItems:"center"}}>
                      <div style={{fontSize:22}}>🏆</div>
                      <div>
                        <div style={{fontSize:10,color:c.ac,fontWeight:700,letterSpacing:"0.06em",marginBottom:2}}>MIGLIORE STRATEGIA — EXPECTANCY</div>
                        <div style={{fontSize:15,fontWeight:700}}>{best.nome}</div>
                        <div style={{fontSize:11,color:c.txm}}>Expectancy {fmtR(best.exp)} · WR {best.wr}% · PF {best.pf} · {best.total} trade</div>
                      </div>
                    </div>
                  )}
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {ranked.map(function(s,rank){
                      const barW=best&&best.exp>0?Math.min((s.exp/best.exp)*100,100):50;
                      return(
                        <div key={s.id} style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                            <div style={{display:"flex",gap:10,alignItems:"center"}}>
                              <div style={{width:26,height:26,borderRadius:8,background:rank===0?c.ac+"15":c.bd,border:"1px solid "+(rank===0?c.ac:c.bd),display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:rank===0?c.ac:c.txm}}>#{rank+1}</div>
                              <div>
                                <div style={{fontSize:13,fontWeight:700}}>{s.nome}</div>
                                <div style={{fontSize:10,color:c.txm}}>{s.total} trade · {s.wr}% WR</div>
                              </div>
                            </div>
                            <div style={{textAlign:"right"}}>
                              <div style={{fontSize:14,fontWeight:700,color:s.totalR>=0?c.gr:c.rd}}>{fmtVal(s.totalR,s._pnl,s._pct)}</div>
                              <div style={{fontSize:10,color:c.txm}}>PF {s.pf}</div>
                            </div>
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:8}}>
                            {[{l:"Expectancy",v:fmtR(s.exp),col:s.exp>=0?c.gr:c.rd},{l:"Max DD",v:"-"+s.maxDD+"R",col:c.rd},{l:"Max Win",v:s.streak.maxW+" cons.",col:c.gr},{l:"Max Loss",v:s.streak.maxL+" cons.",col:c.rd}].map(function(mm,i){return(
                              <div key={i} style={{background:c.bg,borderRadius:7,padding:"6px 9px"}}>
                                <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:1}}>{mm.l}</div>
                                <div style={{fontSize:11,fontWeight:700,color:mm.col}}>{mm.v}</div>
                              </div>
                            );})}
                          </div>
                          <div style={{height:4,borderRadius:3,background:c.bd}}>
                            <div style={{height:"100%",width:Math.max(barW,0)+"%",background:s.exp>=0?c.gr:c.rd,borderRadius:3,opacity:0.7,transition:"width 0.4s"}}/>
                          </div>
                        </div>
                      );
                    })}
                    {ranked.length===0&&<div style={{textAlign:"center",padding:"40px",color:c.txm,fontSize:12}}>Nessuna strategia con trade nel periodo filtrato.</div>}
                  </div>
                </>
              );
            })()}
          
            {/* ── TAB: TAGS ── */}
            {tab==="tags"&&(function(){
              // Collect all tags across filtered trades
              const tagMap={};
              filtered.forEach(function(t){
                (t.tags||[]).forEach(function(tag){
                  if(!tagMap[tag]) tagMap[tag]={tag,total:0,wins:0,losses:0,be:0,totalR:0,totalPnl:0};
                  tagMap[tag].total++;
                  if(t.r_result>0) tagMap[tag].wins++;
                  else if(t.r_result<0) tagMap[tag].losses++;
                  else tagMap[tag].be++;
                  tagMap[tag].totalR+=t.r_result||0;
                  tagMap[tag].totalPnl+=t.pnl_eur||0;
                });
              });
              const tags=Object.values(tagMap).sort(function(a,b){return b.total-a.total;});
              if(tags.length===0) return(
                <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>
                  <div style={{fontSize:32,marginBottom:12}}>🏷</div>
                  <div style={{fontWeight:600,marginBottom:6}}>Nessun tag trovato</div>
                  <div style={{fontSize:11}}>Aggiungi tag ai trade (es. "London Session", "Revenge Trade", "A+ Setup") per vedere le analytics per tag.</div>
                </div>
              );
              return(
                <>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:16}}>
                    {[
                      {l:"Tag totali",v:tags.length,col:c.ac},
                      {l:"Trade taggati",v:filtered.filter(function(t){return (t.tags||[]).length>0;}).length,col:c.tx},
                      {l:"Trade senza tag",v:filtered.filter(function(t){return (t.tags||[]).length===0;}).length,col:c.txm},
                    ].map(function(m){return(
                      <div key={m.l} style={{background:c.card,borderRadius:10,padding:"12px 14px",border:"1px solid "+c.bd}}>
                        <div style={{fontSize:10,color:c.txm,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>{m.l}</div>
                        <div style={{fontSize:20,fontWeight:800,color:m.col}}>{m.v}</div>
                      </div>
                    );})}
                  </div>
                  {/* Tabella tag */}
                  <div style={{background:c.card,borderRadius:12,border:"1px solid "+c.bd,overflow:"hidden",marginBottom:16}}>
                    <div style={{display:"grid",gridTemplateColumns:"140px 60px 60px 60px 80px 80px 80px",padding:"8px 14px",background:c.tag,gap:0}}>
                      {["Tag","Trade","Win","Loss","Win%","Exp(R)","P&L"].map(function(h){return(
                        <div key={h} style={{fontSize:9,fontWeight:700,color:c.txm,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</div>
                      );})}
                    </div>
                    {tags.map(function(tg,i){
                      const wr=tg.total>0?Math.round((tg.wins/tg.total)*100):0;
                      const exp=tg.total>0?parseFloat((tg.totalR/tg.total).toFixed(2)):0;
                      return(
                        <div key={tg.tag} style={{display:"grid",gridTemplateColumns:"140px 60px 60px 60px 80px 80px 80px",padding:"9px 14px",borderTop:"1px solid "+c.bdl,gap:0,alignItems:"center"}}>
                          <div style={{fontSize:11,fontWeight:600,padding:"2px 8px",borderRadius:20,background:c.ac+"12",color:c.ac,display:"inline-block",maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tg.tag}</div>
                          <div style={{fontSize:11,fontWeight:700}}>{tg.total}</div>
                          <div style={{fontSize:11,color:c.gr,fontWeight:600}}>{tg.wins}</div>
                          <div style={{fontSize:11,color:c.rd,fontWeight:600}}>{tg.losses}</div>
                          <div style={{fontSize:12,fontWeight:700,color:wr>=60?c.gr:wr>=40?c.am:c.rd}}>{wr}%</div>
                          <div style={{fontSize:12,fontWeight:700,color:exp>0?c.gr:exp<0?c.rd:c.txm}}>{exp>0?"+":""}{exp}R</div>
                          <div style={{fontSize:11,fontWeight:600,color:tg.totalPnl>=0?c.gr:c.rd}}>{tg.totalPnl>=0?"+":""}{tg.totalPnl.toFixed(0)}$</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Bar chart expectancy per tag */}
                  <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:16}}>
                    <div style={{fontSize:11,fontWeight:700,marginBottom:10}}>📊 Expectancy per Tag</div>
                    {(function(){
                      const maxAbs=Math.max(...tags.map(function(tg){return Math.abs(tg.totalR/Math.max(tg.total,1));}),0.01);
                      return(
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {tags.slice(0,12).map(function(tg){
                            const exp=tg.total>0?tg.totalR/tg.total:0;
                            const pct=Math.abs(exp)/maxAbs*100;
                            const col=exp>0?c.gr:exp<0?c.rd:c.bd;
                            return(
                              <div key={tg.tag} style={{display:"flex",alignItems:"center",gap:8}}>
                                <div style={{width:110,fontSize:10,fontWeight:600,color:c.tx,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flexShrink:0}}>{tg.tag}</div>
                                <div style={{flex:1,height:20,background:c.bdl,borderRadius:4,overflow:"hidden",position:"relative"}}>
                                  <div style={{position:"absolute",left:exp>=0?"50%":undefined,right:exp<0?"50%":undefined,width:pct/2+"%",height:"100%",background:col,borderRadius:4,opacity:0.8}}/>
                                  <div style={{position:"absolute",left:"50%",top:0,bottom:0,width:1,background:c.bd}}/>
                                </div>
                                <div style={{width:50,fontSize:11,fontWeight:700,color:col,textAlign:"right",flexShrink:0}}>{exp>0?"+":""}{exp.toFixed(2)}R</div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Top tag insights */}
                  {(function(){
                    const sorted=tags.filter(function(tg){return tg.total>=3;});
                    const best=sorted.slice().sort(function(a,b){return (b.totalR/b.total)-(a.totalR/a.total);})[0];
                    const worst=sorted.slice().sort(function(a,b){return (a.totalR/a.total)-(b.totalR/b.total);})[0];
                    if(!best||!worst) return null;
                    return(
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                        <div style={{background:c.gr+"08",borderRadius:10,padding:"12px 14px",border:"1px solid "+c.gr+"20"}}>
                          <div style={{fontSize:9,fontWeight:700,color:c.gr,textTransform:"uppercase",marginBottom:4}}>🏆 Tag migliore (≥3 trade)</div>
                          <div style={{fontSize:13,fontWeight:800}}>{best.tag}</div>
                          <div style={{fontSize:11,color:c.txm}}>{(best.totalR/best.total).toFixed(2)}R avg · {Math.round(best.wins/best.total*100)}% WR</div>
                        </div>
                        <div style={{background:c.rd+"08",borderRadius:10,padding:"12px 14px",border:"1px solid "+c.rd+"20"}}>
                          <div style={{fontSize:9,fontWeight:700,color:c.rd,textTransform:"uppercase",marginBottom:4}}>⚠ Tag peggiore (≥3 trade)</div>
                          <div style={{fontSize:13,fontWeight:800}}>{worst.tag}</div>
                          <div style={{fontSize:11,color:c.txm}}>{(worst.totalR/worst.total).toFixed(2)}R avg · {Math.round(worst.wins/worst.total*100)}% WR</div>
                        </div>
                      </div>
                    );
                  })()}
                </>
              );
            })()}

            {/* ── TAB: PSICOLOGIA ── */}
            {tab==="psicologia"&&(function(){
              const MOODS_LIST=["😌 Calmo","😐 Neutro","😰 Ansioso","😤 Frustrato","😵 Euforico","😴 Stanco"];
              // Stats by mood
              const moodStats={};
              filtered.forEach(function(t){
                if(!t.mood) return;
                if(!moodStats[t.mood]) moodStats[t.mood]={mood:t.mood,total:0,wins:0,totalR:0,sizes:[],execScores:[]};
                moodStats[t.mood].total++;
                if(t.r_result>0) moodStats[t.mood].wins++;
                moodStats[t.mood].totalR+=t.r_result||0;
                if(t.size) moodStats[t.mood].sizes.push(t.size);
                if(t.sc_esecuzione) moodStats[t.mood].execScores.push(t.sc_esecuzione);
              });
              const moodRows=Object.values(moodStats).sort(function(a,b){return b.total-a.total;});

              // Compliance rate by strategy
              const stratCompliance={};
              filtered.forEach(function(t){
                const ck=t.checklist||{};
                const keys=Object.keys(ck);
                if(keys.length===0) return;
                const sid=t.strategia_id||"_none";
                if(!stratCompliance[sid]) stratCompliance[sid]={sid,total:0,compliantAll:0,partial:0,totalR_comp:0,totalR_part:0,n_comp:0,n_part:0};
                const checked=keys.filter(function(k){return ck[k];}).length;
                const ratio=checked/keys.length;
                stratCompliance[sid].total++;
                if(ratio===1){stratCompliance[sid].compliantAll++;stratCompliance[sid].totalR_comp+=t.r_result||0;stratCompliance[sid].n_comp++;}
                else{stratCompliance[sid].partial++;stratCompliance[sid].totalR_part+=t.r_result||0;stratCompliance[sid].n_part++;}
              });
              const compRows=Object.values(stratCompliance);

              // Sizing correlation: avg size by mood
              const hasSizing=moodRows.some(function(m){return m.sizes.length>0;});
              const hasCompliance=compRows.length>0;

              return(
                <>
                  {/* Mood stats */}
                  <div style={{marginBottom:16}}>
                    <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Performance per Stato Mentale</div>
                    {moodRows.length===0?(
                      <div style={{padding:"24px",textAlign:"center",color:c.txm,fontSize:12,background:c.card,borderRadius:10,border:"1px solid "+c.bd}}>
                        Compila il campo "Stato Mentale" nei trade per vedere questa analisi.
                      </div>
                    ):(
                      <div style={{background:c.card,borderRadius:12,border:"1px solid "+c.bd,overflow:"hidden"}}>
                        <div style={{display:"grid",gridTemplateColumns:"130px 60px 70px 80px 80px 80px",padding:"8px 14px",background:c.tag,gap:0}}>
                          {["Stato","Trade","Win%","Exp(R)","Size media","Voto exec"].map(function(h){return(
                            <div key={h} style={{fontSize:9,fontWeight:700,color:c.txm,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</div>
                          );})}
                        </div>
                        {moodRows.map(function(m){
                          const wr=m.total>0?Math.round((m.wins/m.total)*100):0;
                          const exp=m.total>0?parseFloat((m.totalR/m.total).toFixed(2)):0;
                          const avgSize=m.sizes.length>0?parseFloat((m.sizes.reduce(function(a,b){return a+b;},0)/m.sizes.length).toFixed(2)):null;
                          const avgExec=m.execScores.length>0?parseFloat((m.execScores.reduce(function(a,b){return a+b;},0)/m.execScores.length).toFixed(1)):null;
                          return(
                            <div key={m.mood} style={{display:"grid",gridTemplateColumns:"130px 60px 70px 80px 80px 80px",padding:"9px 14px",borderTop:"1px solid "+c.bdl,gap:0,alignItems:"center"}}>
                              <div style={{fontSize:11,fontWeight:600}}>{m.mood}</div>
                              <div style={{fontSize:11}}>{m.total}</div>
                              <div style={{fontSize:12,fontWeight:700,color:wr>=60?c.gr:wr>=40?c.am:c.rd}}>{wr}%</div>
                              <div style={{fontSize:12,fontWeight:700,color:exp>0?c.gr:exp<0?c.rd:c.txm}}>{exp>0?"+":""}{exp}R</div>
                              <div style={{fontSize:11,color:c.tx}}>{avgSize!=null?avgSize+"L":"—"}</div>
                              <div style={{fontSize:11,fontWeight:700,color:avgExec>=7?c.gr:avgExec>=5?c.am:avgExec?c.rd:c.txm}}>{avgExec!=null?avgExec+"/10":"—"}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Correlazione Sizing + Stato Mentale */}
                  {hasSizing&&(
                    <div style={{marginBottom:16}}>
                      <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>📐 Correlazione Sizing e Stato Mentale</div>
                      <div style={{background:c.card,borderRadius:12,border:"1px solid "+c.bd,overflow:"hidden",marginBottom:10}}>
                        <div style={{display:"grid",gridTemplateColumns:"130px 80px 80px 80px 80px",padding:"8px 14px",background:c.tag,gap:0}}>
                          {["Stato","Trade con size","Size media","Size min","Size max"].map(function(h){return(
                            <div key={h} style={{fontSize:9,fontWeight:700,color:c.txm,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</div>
                          );})}
                        </div>
                        {moodRows.filter(function(m){return m.sizes.length>0;}).map(function(m){
                          const avg=m.sizes.reduce(function(a,b){return a+b;},0)/m.sizes.length;
                          const min_=Math.min.apply(null,m.sizes);
                          const max_=Math.max.apply(null,m.sizes);
                          // Reference: calm avg
                          const calmAvg=moodStats["😌 Calmo"]?.sizes?.length>0?moodStats["😌 Calmo"].sizes.reduce(function(a,b){return a+b;},0)/moodStats["😌 Calmo"].sizes.length:null;
                          const deviation=calmAvg?((avg/calmAvg)-1)*100:0;
                          const devColor=Math.abs(deviation)>20?c.rd:Math.abs(deviation)>10?c.am:c.gr;
                          return(
                            <div key={m.mood} style={{display:"grid",gridTemplateColumns:"130px 80px 80px 80px 80px",padding:"9px 14px",borderTop:"1px solid "+c.bdl,gap:0,alignItems:"center"}}>
                              <div style={{fontSize:11,fontWeight:600}}>{m.mood}</div>
                              <div style={{fontSize:11}}>{m.sizes.length}</div>
                              <div style={{fontSize:12,fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
                                {avg.toFixed(2)}L
                                {calmAvg&&Math.abs(deviation)>5&&(
                                  <span style={{fontSize:9,fontWeight:700,color:devColor}}>
                                    {deviation>0?"+":""}{deviation.toFixed(0)}%
                                  </span>
                                )}
                              </div>
                              <div style={{fontSize:11,color:c.txm}}>{min_.toFixed(2)}L</div>
                              <div style={{fontSize:11,color:c.txm}}>{max_.toFixed(2)}L</div>
                            </div>
                          );
                        })}
                      </div>
                      {/* Visual bar chart */}
                      {(function(){
                        const sizingRows=moodRows.filter(function(m){return m.sizes.length>0;});
                        const maxAvg=Math.max(...sizingRows.map(function(m){return m.sizes.reduce(function(a,b){return a+b;},0)/m.sizes.length;}));
                        const calmAvg=moodStats["😌 Calmo"]?.sizes?.length>0?moodStats["😌 Calmo"].sizes.reduce(function(a,b){return a+b;},0)/moodStats["😌 Calmo"].sizes.length:null;
                        return(
                          <div style={{marginBottom:10}}>
                            {sizingRows.map(function(m){
                              const avg=m.sizes.reduce(function(a,b){return a+b;},0)/m.sizes.length;
                              const pct=maxAvg>0?(avg/maxAvg)*100:50;
                              const deviation=calmAvg?((avg/calmAvg)-1)*100:0;
                              const col=!calmAvg||Math.abs(deviation)<=10?c.gr:Math.abs(deviation)<=20?c.am:c.rd;
                              return(
                                <div key={m.mood} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                                  <div style={{width:90,fontSize:10,flexShrink:0}}>{m.mood}</div>
                                  <div style={{flex:1,height:18,background:c.bdl,borderRadius:4,overflow:"hidden"}}>
                                    <div style={{width:pct+"%",height:"100%",background:col,borderRadius:4,opacity:0.75,transition:"width 0.3s"}}/>
                                  </div>
                                  <div style={{width:45,fontSize:10,fontWeight:700,color:col,textAlign:"right",flexShrink:0}}>{avg.toFixed(2)}L</div>
                                </div>
                              );
                            })}
                            {calmAvg&&<div style={{fontSize:10,color:c.txm,marginTop:4}}>Riferimento: dimensione media in stato Calmo = {calmAvg.toFixed(2)}L</div>}
                          </div>
                        );
                      })()}
                      {/* Alert insights */}
                      {(function(){
                        const calmSize=moodStats["😌 Calmo"]?.sizes||[];
                        const frustSize=moodStats["😤 Frustrato"]?.sizes||[];
                        const eufSize=moodStats["😵 Euforico"]?.sizes||[];
                        const avgCalm=calmSize.length>0?calmSize.reduce(function(a,b){return a+b;},0)/calmSize.length:null;
                        const avgFrust=frustSize.length>0?frustSize.reduce(function(a,b){return a+b;},0)/frustSize.length:null;
                        const avgEuf=eufSize.length>0?eufSize.reduce(function(a,b){return a+b;},0)/eufSize.length:null;
                        const alerts_=[];
                        if(avgCalm&&avgFrust&&avgFrust>avgCalm*1.2) alerts_.push({msg:"Quando sei Frustrato la tua size è "+avgFrust.toFixed(2)+"L vs "+avgCalm.toFixed(2)+"L da Calmo (+"+Math.round((avgFrust/avgCalm-1)*100)+"%). Possibile revenge trading — questa è la causa numero 1 di account blown.",col:c.rd});
                        if(avgCalm&&avgEuf&&avgEuf>avgCalm*1.2) alerts_.push({msg:"Quando sei Euforico la tua size è "+avgEuf.toFixed(2)+"L vs "+avgCalm.toFixed(2)+"L da Calmo (+"+Math.round((avgEuf/avgCalm-1)*100)+"%). Attenzione all'overtrading dopo una serie positiva.",col:c.am});
                        if(avgCalm&&avgFrust&&avgFrust<avgCalm*0.8) alerts_.push({msg:"Quando sei Frustrato riduci la size ("+avgFrust.toFixed(2)+"L vs "+avgCalm.toFixed(2)+"L). Ottima gestione del rischio psicologico.",col:c.gr});
                        if(alerts_.length===0&&avgCalm) alerts_.push({msg:"✅ La tua size rimane stabile indipendentemente dallo stato mentale. Ottima disciplina nel risk management.",col:c.gr});
                        return alerts_.map(function(a,i){return(
                          <div key={i} style={{padding:"10px 12px",borderRadius:8,background:a.col+"10",border:"1px solid "+a.col+"30",fontSize:11,color:a.col,lineHeight:1.6,marginBottom:6}}>
                            {a.msg}
                          </div>
                        );});
                      })()}
                    </div>
                  )}

                  {/* Compliance rate */}
                  <div style={{marginBottom:16}}>
                    <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Compliance Checklist per Strategia</div>
                    {!hasCompliance?(
                      <div style={{padding:"24px",textAlign:"center",color:c.txm,fontSize:12,background:c.card,borderRadius:10,border:"1px solid "+c.bd}}>
                        Compila la checklist nei trade (tab Journal Emotivo) per vedere il compliance rate.
                      </div>
                    ):(
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {compRows.map(function(row){
                          const strat=strategie.find(function(s){return s.id===row.sid;})||null;
                          const expComp=row.n_comp>0?parseFloat((row.totalR_comp/row.n_comp).toFixed(2)):null;
                          const expPart=row.n_part>0?parseFloat((row.totalR_part/row.n_part).toFixed(2)):null;
                          const compRate=row.total>0?Math.round((row.compliantAll/row.total)*100):0;
                          return(
                            <div key={row.sid} style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd}}>
                              <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>{strat?strat.nome:"Strategia sconosciuta"}</div>
                              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:10}}>
                                <div style={{textAlign:"center",padding:"8px",borderRadius:8,background:c.bg}}>
                                  <div style={{fontSize:9,color:c.txm,fontWeight:600,textTransform:"uppercase",marginBottom:2}}>Compliance</div>
                                  <div style={{fontSize:18,fontWeight:800,color:compRate>=70?c.gr:compRate>=40?c.am:c.rd}}>{compRate}%</div>
                                </div>
                                <div style={{textAlign:"center",padding:"8px",borderRadius:8,background:c.gr+"10",border:"1px solid "+c.gr+"20"}}>
                                  <div style={{fontSize:9,color:c.gr,fontWeight:600,textTransform:"uppercase",marginBottom:2}}>✓ Piano rispettato</div>
                                  <div style={{fontSize:14,fontWeight:800,color:expComp!=null?expComp>0?c.gr:c.rd:c.txm}}>{expComp!=null?(expComp>0?"+":"")+expComp+"R":"—"}</div>
                                  <div style={{fontSize:9,color:c.txm}}>{row.compliantAll} trade</div>
                                </div>
                                <div style={{textAlign:"center",padding:"8px",borderRadius:8,background:c.am+"10",border:"1px solid "+c.am+"20"}}>
                                  <div style={{fontSize:9,color:c.am,fontWeight:600,textTransform:"uppercase",marginBottom:2}}>⚠ Piano parziale</div>
                                  <div style={{fontSize:14,fontWeight:800,color:expPart!=null?expPart>0?c.gr:c.rd:c.txm}}>{expPart!=null?(expPart>0?"+":"")+expPart+"R":"—"}</div>
                                  <div style={{fontSize:9,color:c.txm}}>{row.partial} trade</div>
                                </div>
                              </div>
                              {expComp!=null&&expPart!=null&&(
                                <div style={{padding:"8px 12px",borderRadius:8,background:expComp>expPart?c.gr+"08":c.rd+"08",border:"1px solid "+(expComp>expPart?c.gr:c.rd)+"20",fontSize:11,color:c.tx,lineHeight:1.5}}>
                                  {expComp>expPart
                                    ? "✅ Quando rispetti il piano hai una expectancy di "+expComp+"R vs "+expPart+"R quando non lo rispetti. Differenza: +"+(expComp-expPart).toFixed(2)+"R per trade."
                                    : "⚠ Attenzione: rispettare il piano dà "+expComp+"R vs "+expPart+"R. Controlla se il piano è aggiornato o se la strategia va rivista."}
                                </div>
                              )}
                              {/* Dettaglio voce per voce */}
                              {(function(){
                                const strat2=strategie.find(function(s){return s.id===row.sid;})||null;
                                if(!strat2) return null;
                                const allItems=[...(strat2.checklist?.bias||[]),...(strat2.checklist?.trigger||[]),...(strat2.checklist?.contesto||[]),...(strat2.checklist?.gestione||[])];
                                if(allItems.length===0) return null;
                                const tradesWithCk=filtered.filter(function(t){return t.strategia_id===row.sid&&t.checklist&&Object.keys(t.checklist).length>0;});
                                if(tradesWithCk.length===0) return null;
                                const itemStats=allItems.map(function(item){
                                  const withItem=tradesWithCk.filter(function(t){return !!t.checklist[item];});
                                  const withoutItem=tradesWithCk.filter(function(t){return !t.checklist[item];});
                                  const expWith=withItem.length>0?parseFloat((withItem.reduce(function(s,t){return s+t.r_result;},0)/withItem.length).toFixed(2)):null;
                                  const expWithout=withoutItem.length>0?parseFloat((withoutItem.reduce(function(s,t){return s+t.r_result;},0)/withoutItem.length).toFixed(2)):null;
                                  const checkRate=tradesWithCk.length>0?Math.round((withItem.length/tradesWithCk.length)*100):0;
                                  return {item,withItem:withItem.length,withoutItem:withoutItem.length,expWith,expWithout,checkRate};
                                });
                                return(
                                  <div style={{marginTop:10}}>
                                    <div style={{fontSize:10,fontWeight:700,color:c.txm,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Dettaglio per voce</div>
                                    {itemStats.map(function(s){
                                      const hasData=s.expWith!=null||s.expWithout!=null;
                                      const positive=s.expWith!=null&&(s.expWithout==null||s.expWith>s.expWithout);
                                      return(
                                        <div key={s.item} style={{padding:"8px 10px",borderRadius:7,background:c.bg,marginBottom:5,display:"flex",alignItems:"center",gap:10}}>
                                          <div style={{flex:1}}>
                                            <div style={{fontSize:11,fontWeight:600,marginBottom:2}}>{s.item}</div>
                                            <div style={{fontSize:10,color:c.txm}}>Rispettata nel {s.checkRate}% dei trade ({s.withItem}/{s.withItem+s.withoutItem})</div>
                                          </div>
                                          {hasData&&(
                                            <div style={{display:"flex",gap:6,alignItems:"center"}}>
                                              {s.expWith!=null&&<div style={{textAlign:"center"}}>
                                                <div style={{fontSize:9,color:c.gr,fontWeight:600}}>✓ Con</div>
                                                <div style={{fontSize:12,fontWeight:700,color:s.expWith>0?c.gr:c.rd}}>{s.expWith>0?"+":""}{s.expWith}R</div>
                                              </div>}
                                              {s.expWithout!=null&&<div style={{textAlign:"center"}}>
                                                <div style={{fontSize:9,color:c.rd,fontWeight:600}}>✕ Senza</div>
                                                <div style={{fontSize:12,fontWeight:700,color:s.expWithout>0?c.gr:c.rd}}>{s.expWithout>0?"+":""}{s.expWithout}R</div>
                                              </div>}
                                              <div style={{width:6,height:6,borderRadius:"50%",background:positive?c.gr:c.rd,flexShrink:0}}/>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

          </>
        )}
      </div>
    </div>
  );
}

// ── IMPOSTAZIONI ──────────────────────────────────────────────────────────────
function Impostazioni({c,dark,setDark,reload,conti,strategie}){
  const [lingua,setLingua]=useState("it");
  const [showCsvImport,setShowCsvImport]=useState(false);
  const [alertData,setAlertData]=useState(null);

  async function exportData(){
    const strats=await db.strategie.toArray();
    const conti_=await db.conti.toArray();
    const trades=await db.trade.toArray();
    const data=JSON.stringify({version:"1.0",exported:new Date().toISOString(),strategie:strats,conti:conti_,trades},null,2);
    const blob=new Blob([data],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download="edgelab-backup-"+new Date().toISOString().split("T")[0]+".json";
    document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  }

  async function importData(e){
    const file=e.target.files[0];if(!file) return;
    const text=await file.text();
    try{
      const data=JSON.parse(text);
      const stratIdMap={};const contoIdMap={};
      let addedStrat=0,addedConti=0,addedTrade=0;
      if(data.strategie){for(const s of data.strategie){const oldId=s.id;const {id,...rest}=s;const newId=await db.strategie.add(rest);stratIdMap[oldId]=newId;addedStrat++;}}
      if(data.conti){for(const cn of data.conti){const oldId=cn.id;const {id,...rest}=cn;if(rest.strategie_ids&&Array.isArray(rest.strategie_ids)){rest.strategie_ids=rest.strategie_ids.map(function(sid){return stratIdMap[sid]||sid;});}const newId=await db.conti.add(rest);contoIdMap[oldId]=newId;addedConti++;}}
      if(data.trades){for(const t of data.trades){const {id,...rest}=t;if(rest.conto_id&&contoIdMap[rest.conto_id])rest.conto_id=contoIdMap[rest.conto_id];if(rest.strategia_id&&stratIdMap[rest.strategia_id])rest.strategia_id=stratIdMap[rest.strategia_id];await db.trade.add(rest);addedTrade++;}}
      await reload();
      setAlertData({title:"Import completato",message:"Aggiunti: "+addedStrat+" strategie, "+addedConti+" conti, "+addedTrade+" trade",type:"success"});
    }catch(err){setAlertData({title:"Errore import",message:err.message,type:"error"});}
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"12px 20px",borderBottom:"1px solid "+c.bd,background:c.sb,flexShrink:0}}>
        <div style={{fontSize:15,fontWeight:700}}>Impostazioni</div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        <div style={{maxWidth:560,display:"flex",flexDirection:"column",gap:12}}>

          {/* Preferenze */}
          <div style={{background:c.card,borderRadius:12,padding:"16px",border:"1px solid "+c.bd}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:14}}>Preferenze</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid "+c.bdl}}>
              <div><div style={{fontSize:12,fontWeight:600}}>Tema</div></div>
              <div style={{display:"flex",gap:5}}>
                {[{v:false,l:"☀ Chiaro"},{v:true,l:"☾ Scuro"}].map(function(t){return(
                  <button key={t.l} onClick={function(){setDark(t.v);}} style={{padding:"6px 12px",borderRadius:7,border:"1px solid "+(dark===t.v?c.ac:c.bd),background:dark===t.v?c.ac+"15":"transparent",color:dark===t.v?c.ac:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:dark===t.v?600:400}}>{t.l}</button>
                );})}
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0"}}>
              <div><div style={{fontSize:12,fontWeight:600}}>Lingua</div></div>
              <select value={lingua} onChange={function(e){setLingua(e.target.value);}} style={{padding:"7px 12px",borderRadius:8,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                <option value="it">🇮🇹 Italiano</option><option value="en">🇬🇧 English</option>
              </select>
            </div>
          </div>

          {/* Import CSV — prominente */}
          <div style={{background:"linear-gradient(135deg,"+c.ac+"12,"+c.ac+"06)",borderRadius:12,padding:"18px",border:"1px solid "+c.ac+"30"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
              <div style={{fontSize:22}}>📊</div>
              <div>
                <div style={{fontSize:13,fontWeight:800,color:c.tx}}>Import Trade da Broker</div>
                <div style={{fontSize:10,color:c.txm}}>cTrader · MetaTrader 4 · MetaTrader 5</div>
              </div>
            </div>
            <div style={{fontSize:11,color:c.txm,marginBottom:12,lineHeight:1.6}}>
              Importa il tuo storico trade in pochi secondi. MAE/MFE puoi aggiungerli dopo dal Journal.
            </div>
            <button onClick={function(){setShowCsvImport(true);}}
              style={{width:"100%",padding:"10px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              📥 Importa CSV
            </button>
          </div>

          {/* FUSO ORARIO */}
          <div style={{background:c.card,borderRadius:12,padding:"16px",border:"1px solid "+c.bd,marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:4}}>🌐 Fuso Orario</div>
            <div style={{fontSize:11,color:c.txm,marginBottom:12,lineHeight:1.6}}>
              Imposta il tuo fuso orario per sessioni e orari corretti nelle Analytics e nel Coach.
            </div>
            <select
              defaultValue={localStorage.getItem("el_tz_offset")||"auto"}
              onChange={function(e){localStorage.setItem("el_tz_offset",e.target.value);}}
              style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer",marginBottom:10}}>
              <option value="auto">🔄 Automatico (ora del browser) — consigliato</option>
              {TZ_LIST.map(function(tz,i){return(
                <option key={i} value={String(tz.offset)}>{tz.label}</option>
              );})}
            </select>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
              {(function(){
                const raw=localStorage.getItem("el_tz_offset");
                const off=raw&&raw!=="auto"?parseInt(raw):(-new Date().getTimezoneOffset()/60);
                const delta=off-1;
                function fmtH(h){return((h%24+24)%24)+":00";}
                return [
                  {s:"Asian",start:23+delta,end:8+delta},
                  {s:"London",start:8+delta,end:14+delta},
                  {s:"NY",start:14+delta,end:22+delta},
                ].map(function(ss){return(
                  <div key={ss.s} style={{background:c.bg,borderRadius:8,padding:"8px 10px",textAlign:"center",border:"1px solid "+c.bd}}>
                    <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:3}}>{ss.s}</div>
                    <div style={{fontSize:10,fontWeight:600}}>{fmtH(ss.start)} – {fmtH(ss.end)}</div>
                  </div>
                );});
              })()}
            </div>
          </div>

          {/* Backup JSON */}
          <div style={{background:c.card,borderRadius:12,padding:"16px",border:"1px solid "+c.bd}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:14}}>Backup Dati</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",borderRadius:8,background:c.bg}}>
                <div><div style={{fontSize:12,fontWeight:600}}>Esporta dati</div><div style={{fontSize:10,color:c.txm}}>Backup completo JSON (strategie + conti + trade)</div></div>
                <button onClick={exportData} style={{padding:"7px 14px",borderRadius:7,border:"1px solid "+c.bd,background:c.card,color:c.tx,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>⬇ Esporta</button>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",borderRadius:8,background:c.bg}}>
                <div><div style={{fontSize:12,fontWeight:600}}>Importa dati</div><div style={{fontSize:10,color:c.txm}}>Ripristina da backup JSON</div></div>
                <label style={{padding:"7px 14px",borderRadius:7,border:"1px solid "+c.bd,background:c.card,color:c.tx,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                  ⬆ Importa<input type="file" accept=".json" onChange={importData} style={{display:"none"}}/>
                </label>
              </div>
            </div>
          </div>

          {/* Info */}
          <div style={{background:c.card,borderRadius:12,padding:"16px",border:"1px solid "+c.bd}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Info</div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <EdgeLabLogo size={20}/>
              <div>
                <div style={{fontSize:12,fontWeight:800,letterSpacing:"-0.02em"}}>EdgeLab</div>
                <div style={{fontSize:9,color:"#6366F1",letterSpacing:"0.08em",textTransform:"uppercase"}}>Trade smarter, not harder</div>
              </div>
            </div>
            <div style={{padding:"8px 10px",borderRadius:7,background:c.ac+"10",border:"1px solid "+c.ac+"20",color:c.ac,fontSize:11}}>✓ Tutti i dati salvati localmente nel browser. Zero server. Zero abbonamento.</div>
          </div>

        </div>
      </div>

      {showCsvImport&&(
        <ImportCSV c={c} conti={conti} strategie={strategie} reload={reload} onClose={function(){setShowCsvImport(false);}}/>
      )}
      {alertData&&<AlertModal c={c} title={alertData.title} message={alertData.message} type={alertData.type} onClose={function(){setAlertData(null);}}/>}
    </div>
  );
}

function Ottimizzazione({c,trades,strategie,conti}){
  const [selConti,setSelConti]=useState([]);
  const [selStrat,setSelStrat]=useState([]);
  const [tab,setTab]=useState("storico");
  const [unit,setUnit]=useState("R");
  const [tp,setTp]=useState(2.0);
  const [be,setBe]=useState(0);
  const [botOpen,setBotOpen]=useState(false);
  const [targetWr,setTargetWr]=useState(null);
  const [nProj,setNProj]=useState(50);
  const [stressTest,setStressTest]=useState(false);
  const [stressMfe,setStressMfe]=useState(10); // % riduzione MFE
  const [stressMae,setStressMae]=useState(10); // % peggioramento MAE

  // filtro trade
  const filtered=trades.filter(function(t){
    if(selConti.length>0&&!selConti.includes(t.conto_id)) return false;
    if(selStrat.length>0&&!selStrat.includes(t.strategia_id)) return false;
    return true;
  });

  // calcola R massimo dai MFE reali (arrotondato a 0.1)
  const mfeR=filtered.filter(function(t){return t.mfe!=null;}).map(function(t){
    return Math.round(parseFloat(t.mfe)*10)/10;
  }).filter(function(r){return r>0;});
  const maxMfe=mfeR.length>0?Math.max.apply(null,mfeR):5;
  const pctMfe=filtered.length>0?Math.round((mfeR.length/filtered.length)*100):0;
  const lowMfeWarning=pctMfe<50&&filtered.length>0;

  // genera steps TP (0.5 → maxMfe, step 0.1)
  function genSteps(max){
    const steps=[];
    for(let v=0.5;v<=Math.max(max,5)+0.01;v=Math.round((v+0.1)*10)/10) steps.push(v);
    return steps;
  }
  const tpSteps=genSteps(maxMfe);
  const beSteps=[0,...tpSteps.filter(function(s){return s<tp;})];

  // simula un trade con parametri TP+BE usando MFE/MAE
  function simTrade(t,tpR,beR){
    if(t.mfe==null) return t.r_result;
    // calcola MFE e MAE in R
    let mfeInR=null,maeInR=null;
    if(t.mfe!=null){mfeInR=t.mfe;}
    maeInR=null; // MAE rimosso
    if(mfeInR===null) return t.r_result; // no MFE, usa reale
    // STRESS TEST: MFE ridotto di stressMfe%, MAE peggiora di stressMae%
    if(stressTest){
      mfeInR=mfeInR*(1-stressMfe/100);
      if(maeInR!==null) maeInR=maeInR*(1+stressMae/100);
    }
    // prima controlla se MAE tocca SL prima che MFE tocchi TP
    if(maeInR!==null&&maeInR<=-1){
      if(beR>0&&mfeInR>=beR) return 0; // BE preso
      return -1; // SL pieno
    }
    // MFE raggiunge TP?
    if(mfeInR>=tpR) return tpR;
    // MFE non raggiunge TP — esce all'exit reale
    return stressTest?t.r_result*(1-stressMfe/100):t.r_result;
  }

  // calcola metriche simulate
  function calcSimMetrics(tradeList,tpR,beR){
    const results=tradeList.map(function(t){
      const r=simTrade(t,tpR,beR);
      const pnl=t.pnl_eur!=null?(r/t.r_result)*t.pnl_eur:null;
      return {r,pnl_eur:pnl};
    });
    const wins=results.filter(function(x){return x.r>0;});
    const losses=results.filter(function(x){return x.r<0;});
    const bes=results.filter(function(x){return x.r===0;});
    const totalR=parseFloat(results.reduce(function(s,x){return s+x.r;},0).toFixed(2));
    const totalEur=results.reduce(function(s,x){return s+(x.pnl_eur||0);},0);
    const wr=results.length>0?Math.round((wins.length/results.length)*100):0;
    const grossW=wins.reduce(function(s,x){return s+x.r;},0);
    const grossL=Math.abs(losses.reduce(function(s,x){return s+x.r;},0));
    const pf=grossL>0?parseFloat((grossW/grossL).toFixed(2)):grossW>0?999:0;
    const exp=results.length>0?parseFloat((totalR/results.length).toFixed(2)):0;
    // equity curve
    let eq=0;
    const curve=[{i:0,r:0,eur:0}];
    let eqEur=0;
    results.forEach(function(x,i){eq+=x.r;eqEur+=(x.pnl_eur||0);curve.push({i:i+1,r:parseFloat(eq.toFixed(2)),eur:parseFloat(eqEur.toFixed(2))});});
    // drawdown
    let peak=0,maxDD=0;
    curve.forEach(function(p){if(p.r>peak)peak=p.r;const dd=peak-p.r;if(dd>maxDD)maxDD=dd;});
    return {total:results.length,wins:wins.length,losses:losses.length,be:bes.length,wr,pf,exp,totalR,totalEur:parseFloat(totalEur.toFixed(2)),maxDD:parseFloat(maxDD.toFixed(2)),curve};
  }

  const simCurrent=calcSimMetrics(filtered,tp,be);

  // metriche reali per confronto
  const realMetrics=calcMetrics(filtered);
  const realEur=filtered.reduce(function(s,t){return s+(t.pnl_eur||0);},0);

  // BOT: trova combinazione ottimale TP+BE
  // ── 3 ALTERNATIVE BOT ──
  function findThreeOptimal(){
    if(filtered.length<3) return null;
    let maxR=null,maxPF=null,bestComp=null;
    tpSteps.forEach(function(tpR){
      const beOpts=[0,...tpSteps.filter(function(s){return s<tpR;})];
      beOpts.forEach(function(beR){
        const m=calcSimMetrics(filtered,tpR,beR);
        if(!maxR||m.totalR>maxR.m.totalR) maxR={tpR,beR,m};
        if(!maxPF||parseFloat(m.pf)>parseFloat(maxPF.m.pf)) maxPF={tpR,beR,m};
        // Compromesso: massimizza totalR con WR>=45%
        if(m.wr>=45&&(!bestComp||m.totalR>bestComp.m.totalR)) bestComp={tpR,beR,m};
      });
    });
    if(!bestComp) bestComp=maxR; // fallback
    return {maxR,maxPF,bestComp};
  }
  function findOptimal(targetWrPct){
    let best=null;
    tpSteps.forEach(function(tpR){
      const beOpts=[0,...tpSteps.filter(function(s){return s<tpR;})];
      beOpts.forEach(function(beR){
        const m=calcSimMetrics(filtered,tpR,beR);
        if(!best) {best={tpR,beR,m};return;}
        if(targetWrPct!=null){
          if(m.wr>=targetWrPct&&m.totalR>best.m.totalR) best={tpR,beR,m};
          else if(best.m.wr<targetWrPct&&m.wr>best.m.wr) best={tpR,beR,m};
        } else {
          if(m.totalR>best.m.totalR) best={tpR,beR,m};
        }
      });
    });
    return best;
  }
  // Bar chart data: totalR per ogni TP testato (BE=0)
  const tpBarData=tpSteps.map(function(tpR){
    const m=calcSimMetrics(filtered,tpR,0);
    return {tpR,totalR:m.totalR,wr:m.wr};
  });
  const threeOpt=filtered.length>0?findThreeOptimal():null;
  const optimal=filtered.length>0?findOptimal(targetWr):null;

  // ── PROIEZIONE MONTE CARLO ──
  const [nSim,setNSim]=useState(200);
  const [projData,setProjData]=useState(null);
  const [projLoading,setProjLoading]=useState(false);

  function runProiezione(){
    if(filtered.length===0) return;
    setProjLoading(true);
    setTimeout(function(){
      const base=filtered.map(function(t){return simTrade(t,tp,be);});
      const n=nProj; const nsim=nSim;
      // genera nsim curve da n trade ciascuna
      const allCurves=[];
      for(let s=0;s<nsim;s++){
        let eq=0;
        const curve=[0];
        for(let i=0;i<n;i++){
          const r=base[Math.floor(Math.random()*base.length)];
          eq+=r; curve.push(parseFloat(eq.toFixed(2)));
        }
        allCurves.push(curve);
      }
      // per ogni step calcola percentili
      const steps=[];
      for(let i=0;i<=n;i++){
        const vals=allCurves.map(function(c){return c[i];}).sort(function(a,b){return a-b;});
        const pct=function(p){return vals[Math.floor(p/100*(vals.length-1))];};
        steps.push({i,p5:pct(5),p25:pct(25),p50:pct(50),p75:pct(75),p95:pct(95)});
      }
      // statistiche finali
      const finals=allCurves.map(function(c){return c[n];}).sort(function(a,b){return a-b;});
      const pct=function(p){return finals[Math.floor(p/100*(finals.length-1))];};
      const ruined=finals.filter(function(v){return v<-5;}).length;
      // max drawdown medio
      const avgDD=parseFloat((allCurves.reduce(function(sum,curve){
        let peak=0,dd=0;
        curve.forEach(function(v){if(v>peak)peak=v;if(peak-v>dd)dd=peak-v;});
        return sum+dd;
      },0)/nsim).toFixed(2));
      // streak media peggiore (simulate)
      const avgMaxLoss=parseFloat((allCurves.reduce(function(sum,curve){
        let maxL=0,cur=0;
        for(let i=1;i<curve.length;i++){
          if(curve[i]<curve[i-1]){cur++;if(cur>maxL)maxL=cur;}else cur=0;
        }
        return sum+maxL;
      },0)/nsim).toFixed(1));
      // expectancy simulata
      const expSim=parseFloat((base.reduce(function(a,b){return a+b;},0)/base.length).toFixed(3));
      // win rate simulato
      const wrSim=Math.round(base.filter(function(r){return r>0;}).length/base.length*100);
      setProjData({steps,finals,p5:parseFloat(pct(5).toFixed(2)),p25:parseFloat(pct(25).toFixed(2)),p50:parseFloat(pct(50).toFixed(2)),p75:parseFloat(pct(75).toFixed(2)),p95:parseFloat(pct(95).toFixed(2)),ruinPct:parseFloat((ruined/nsim*100).toFixed(1)),avgDD,avgMaxLoss,expSim,wrSim,n,nsim});
      setProjLoading(false);
    },30);
  }

  // legacy per compatibilità equity chart storico
  const projCurve=[];

  const capMap=makeCapMap(conti);
  const capContOtt=conti.filter(function(cn){return selConti.length===0||selConti.includes(cn.id);}).reduce(function(s,cn){return s+(cn.capitale_iniziale||cn.cap_iniz||0);},0);
  const totalPnlOtt=filtered.reduce(function(s,t){return s+(t.pnl_eur||0);},0);
  const totalPctOtt=calcTotalPct(filtered,capMap);
  function fmtVal(r,eur){
    if(unit==="R") return fmtR(r);
    if(unit==="$"&&eur!=null) return (eur>=0?"+":"")+"$"+Math.abs(eur).toFixed(0);
    if(unit==="%"){
      // usa pnl_eur/cap se disponibile, altrimenti mostra R
      if(eur!=null&&capContOtt>0) return (eur>=0?"+":"")+((eur/capContOtt)*100).toFixed(2)+"%";
      return fmtR(r);
    }
    return fmtR(r);
  }

  function toggleConto(id){setSelConti(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  function toggleStrat(id){setSelStrat(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <ModuleHeader
        title="Ottimizzazione"
        subtitle={filtered.length+" trade nel campione"}
        tooltip="L'Ottimizzazione ti mostra come avresti dovuto gestire ogni trade — dove mettere il Take Profit, quando spostare lo Stop Loss a breakeven, se fare parziali — per massimizzare il risultato sui tuoi dati storici reali. Il Bot Automatico testa tutte le combinazioni possibili e ti dice quale avrebbe prodotto la curva equity migliore. La modalità Manuale ti permette di testare scenari specifici che hai in mente. Lo Stress Test simula condizioni di mercato peggiori (MFE ridotto, MAE peggiorato) per vedere quanto è robusta la tua strategia. Richiede che i trade abbiano il campo MFE compilato."
        c={c}
        right={
          <div style={{display:"flex",gap:2,background:c.tag,borderRadius:8,padding:2}}>
            {["R","$","%"].map(function(u){return(
              <button key={u} onClick={function(){setUnit(u);}} style={{padding:"4px 10px",borderRadius:6,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:unit===u?700:400,background:unit===u?c.ac:"transparent",color:unit===u?"#fff":c.txm}}>{u}</button>
            );})}
          </div>
        }
      />
      {/* FILTRI MULTI-SELEZIONE */}
      <div style={{padding:"10px 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:16,flexShrink:0}}>
        <div>
          <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5,letterSpacing:"0.06em"}}>CONTI</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {conti.map(function(cn){const sel=selConti.includes(cn.id);return(
              <button key={cn.id} onClick={function(){toggleConto(cn.id);}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(sel?c.ac:c.bd),background:sel?c.ac+"15":"transparent",color:sel?c.ac:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{cn.nome}</button>
            );})}
            {conti.length===0&&<span style={{fontSize:10,color:c.txm}}>Nessun conto</span>}
          </div>
        </div>
        <div style={{width:1,background:c.bd}}/>
        <div>
          <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5,letterSpacing:"0.06em"}}>STRATEGIE</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {strategie.map(function(s){const sel=selStrat.includes(s.id);return(
              <button key={s.id} onClick={function(){toggleStrat(s.id);}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(sel?c.ac:c.bd),background:sel?c.ac+"15":"transparent",color:sel?c.ac:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{s.nome}</button>
            );})}
            {strategie.length===0&&<span style={{fontSize:10,color:c.txm}}>Nessuna strategia</span>}
          </div>
        </div>
      </div>
      {/* TABS + STRESS TEST */}
      <div style={{padding:"0 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:4,alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",gap:4,alignItems:"center"}}>
          {[{k:"storico",l:"📊 Storico"},{k:"proiezione",l:"🔮 Proiezione"}].map(function(t){const a=tab===t.k;return(
            <button key={t.k} onClick={function(){setTab(t.k);}} style={{padding:"8px 14px",border:"none",borderBottom:"2px solid "+(a?c.ac:"transparent"),background:"transparent",color:a?c.ac:c.txm,fontSize:12,fontWeight:a?700:400,cursor:"pointer",fontFamily:"inherit"}}>{t.l}</button>
          );})}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,marginRight:4}}>
          {stressTest&&(
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"4px 10px",borderRadius:8,background:c.rd+"10",border:"1px solid "+c.rd+"30"}}>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <span style={{fontSize:9,fontWeight:700,color:c.rd}}>MFE -</span>
                <input type="range" min={5} max={50} step={5} value={stressMfe} onChange={function(e){setStressMfe(Number(e.target.value));}} style={{width:70,accentColor:c.rd}}/>
                <span style={{fontSize:10,fontWeight:700,color:c.rd,minWidth:28}}>{stressMfe}%</span>
              </div>
              <div style={{width:1,height:16,background:c.rd+"40"}}/>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <span style={{fontSize:9,fontWeight:700,color:c.rd}}>MAE +</span>
                <input type="range" min={5} max={50} step={5} value={stressMae} onChange={function(e){setStressMae(Number(e.target.value));}} style={{width:70,accentColor:c.rd}}/>
                <span style={{fontSize:10,fontWeight:700,color:c.rd,minWidth:28}}>{stressMae}%</span>
              </div>
            </div>
          )}
          <button
            onClick={function(){setStressTest(!stressTest);}}
            title="Stress Test: simula slippage e imprecisione umana riducendo MFE e peggiorando MAE"
            style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",borderRadius:20,border:"1px solid "+(stressTest?c.rd:c.bd),background:stressTest?c.rd+"15":"transparent",color:stressTest?c.rd:c.txm,fontSize:11,fontWeight:stressTest?700:400,cursor:"pointer",fontFamily:"inherit"}}
          >
            🔥 Stress {stressTest?"ON":"OFF"}
          </button>
        </div>
      </div>

      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        <DisclaimerCampione n={filtered.length} c={c}/>
        {filtered.length===0?(
          <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Nessun trade nel campione. Seleziona un conto o inserisci dei trade.</div>
        ):(
          <>
            {/* STRESS TEST BANNER */}
            {stressTest&&(
              <div style={{padding:"8px 14px",borderRadius:9,background:c.rd+"10",border:"1px solid "+c.rd+"40",marginBottom:12,display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:14}}>🔥</span>
                <span style={{fontSize:11,color:c.rd,fontWeight:600}}>Stress Test Attivo — MFE ridotto del {stressMfe}%, MAE peggiorato del {stressMae}%. I valori MFE/MAE sono modificati per simulare condizioni reali peggiori (slippage, uscite imprecise).</span>
              </div>
            )}
            {/* WARNING MFE */}
            {lowMfeWarning&&(
              <div style={{padding:"8px 14px",borderRadius:9,background:c.am+"12",border:"1px solid "+c.am+"40",marginBottom:12,display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:14}}>⚠️</span>
                <span style={{fontSize:11,color:c.am,fontWeight:500}}>Solo {pctMfe}% dei trade ha MFE inserito. I risultati simulati potrebbero non essere accurati. Inserisci MFE su più trade per migliorare la qualità dell'analisi.</span>
              </div>
            )}

            {/* BOT — 3 ALTERNATIVE */}
            {threeOpt&&(
              <div style={{marginBottom:14}}>
                <div style={{fontSize:11,fontWeight:700,marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:16}}>🤖</span> Bot Ottimizzazione — 3 Alternative
                  <span style={{fontSize:9,color:c.txm,fontWeight:400,marginLeft:4}}>calcolato su {filtered.length} trade con MFE</span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
                  {[
                    {key:"maxR",label:"Max R Totale",icon:"💰",col:"#4F46E5",desc:"Massimizza il P/L complessivo",data:threeOpt.maxR},
                    {key:"maxPF",label:"Max Profit Factor",icon:"⚖",col:"#0F766E",desc:"Massimizza consistenza e qualità",data:threeOpt.maxPF},
                    {key:"bestComp",label:"Compromesso",icon:"🎯",col:"#D97706",desc:"Bilanciato (WR ≥45% + max R)",data:threeOpt.bestComp},
                  ].map(function(alt){
                    return(
                      <div key={alt.key} style={{background:c.card,borderRadius:12,padding:"14px 15px",border:"2px solid "+alt.col+"30",position:"relative"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
                          <span style={{fontSize:16}}>{alt.icon}</span>
                          <div>
                            <div style={{fontSize:11,fontWeight:800,color:alt.col}}>{alt.label}</div>
                            <div style={{fontSize:9,color:c.txm}}>{alt.desc}</div>
                          </div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:10}}>
                          {[{l:"TP",v:alt.data.tpR+"R"},{l:"BE",v:alt.data.beR>0?alt.data.beR+"R":"No"},{l:"P/L",v:fmtVal(alt.data.m.totalR,alt.data.m.totalEur)},{l:"WR",v:alt.data.m.wr+"%"},{l:"PF",v:alt.data.m.pf},{l:"Exp",v:fmtVal(alt.data.m.exp,null)}].map(function(kpi,ki){return(
                            <div key={ki} style={{background:c.bg,borderRadius:7,padding:"6px 8px"}}>
                              <div style={{fontSize:8,color:c.txm,fontWeight:600}}>{kpi.l}</div>
                              <div style={{fontSize:12,fontWeight:700,color:alt.col}}>{kpi.v}</div>
                            </div>
                          );})}
                        </div>
                        <button onClick={function(){setTp(alt.data.tpR);setBe(alt.data.beR);}} style={{width:"100%",padding:"6px",borderRadius:8,background:alt.col,border:"none",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Applica</button>
                      </div>
                    );
                  })}
                </div>

                {/* BAR CHART TP */}
                {tpBarData.length>0&&(function(){
                  const maxTR=Math.max.apply(null,tpBarData.map(function(d){return d.totalR;}));
                  const minTR=Math.min.apply(null,tpBarData.map(function(d){return d.totalR;}));
                  const range=maxTR-minTR||1;
                  const peakTp=tpBarData.reduce(function(a,b){return b.totalR>a.totalR?b:a;});
                  return(
                    <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd}}>
                      <div style={{fontSize:11,fontWeight:700,marginBottom:4}}>P/L Totale Simulato per Take Profit (BE=0)</div>
                      <div style={{fontSize:10,color:c.txm,marginBottom:12}}>Ogni barra = un TP testato. Il picco è il TP ottimale: <strong style={{color:"#4F46E5"}}>{peakTp.tpR}R</strong> → <strong style={{color:peakTp.totalR>=0?c.gr:c.rd}}>{fmtR(peakTp.totalR)}</strong></div>
                      <div style={{display:"flex",alignItems:"flex-end",gap:3,height:90,padding:"0 2px"}}>
                        {tpBarData.map(function(d,i){
                          const isPeak=d.tpR===peakTp.tpR;
                          const h=Math.max(4,Math.round(((d.totalR-minTR)/range)*74));
                          const col=d.totalR>=0?(isPeak?"#4F46E5":"#4F46E540"):"#DC262640";
                          return(
                            <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                              {isPeak&&<span style={{fontSize:7,fontWeight:700,color:"#4F46E5"}}>▲</span>}
                              <div style={{width:"100%",height:h,background:col,borderRadius:"3px 3px 0 0",transition:"all 0.2s"}} title={d.tpR+"R → "+fmtR(d.totalR)+" (WR "+d.wr+"%)"}/>
                              {i%3===0&&<div style={{fontSize:7,color:c.txs,marginTop:2}}>{d.tpR}</div>}
                            </div>
                          );
                        })}
                      </div>
                      <div style={{fontSize:8,color:c.txs,textAlign:"center",marginTop:4}}>Take Profit (R)</div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* PERSONALIZZA WR TARGET */}
            {optimal&&(
              <div style={{background:c.card,borderRadius:11,padding:"12px 14px",border:"1px solid "+c.bd,marginBottom:12}}>
                <div style={{fontSize:10,fontWeight:700,marginBottom:8}}>🎛 Personalizza Win Rate Target</div>
                <div style={{fontSize:10,color:c.txm,marginBottom:8}}>Forza un vincolo WR minimo — il bot trova la combo più profittevole con quel vincolo.</div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                  {[null,40,50,55,60,65,70].map(function(w){const sel=targetWr===w;return(
                    <button key={w===null?"auto":w} onClick={function(){setTargetWr(w);}} style={{padding:"4px 9px",borderRadius:20,border:"1px solid "+(sel?"#0F766E":c.bd),background:sel?"#0F766E15":"transparent",color:sel?"#0F766E":c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{w===null?"Auto":w+"%"}</button>
                  );})}
                </div>
                {targetWr&&(function(){const cOpt=findOptimal(targetWr);return cOpt?(
                  <div style={{padding:"8px 10px",borderRadius:8,background:"#0F766E10",border:"1px solid #0F766E30"}}>
                    <div style={{fontSize:10,color:"#0F766E",fontWeight:600,marginBottom:4}}>Per WR ≥ {targetWr}% la combo migliore è:</div>
                    <div style={{fontSize:11,fontWeight:700,color:"#0F766E"}}>TP {cOpt.tpR}R · BE {cOpt.beR>0?cOpt.beR+"R":"Nessuno"} → {fmtVal(cOpt.m.totalR,cOpt.m.totalEur)} · WR {cOpt.m.wr}%</div>
                  </div>
                ):null;})()}
              </div>
            )}

            {/* PARAMETRI */}
            <div style={{background:c.card,borderRadius:11,padding:"13px 16px",border:"1px solid "+c.bd,marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:700,marginBottom:10}}>Parametri Simulazione</div>
              <div style={{display:"flex",gap:16,alignItems:"flex-end",flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>TAKE PROFIT</div>
                  <select value={tp} onChange={function(e){setTp(parseFloat(e.target.value));}} style={{padding:"7px 10px",borderRadius:8,border:"1px solid "+c.ac+"50",background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer",minWidth:90}}>
                    {tpSteps.map(function(s){return <option key={s} value={s}>{s}R{s<=maxMfe&&mfeR.length>0?" ✓":""}</option>;})}
                  </select>
                  {mfeR.length>0&&<div style={{fontSize:9,color:c.gr,marginTop:3}}>MFE max reale: {maxMfe}R</div>}
                </div>
                <div>
                  <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>BREAKEVEN</div>
                  <select value={be} onChange={function(e){setBe(parseFloat(e.target.value));}} style={{padding:"7px 10px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer",minWidth:120}}>
                    {beSteps.map(function(s){return <option key={s} value={s}>{s===0?"Nessun BE":s+"R"}</option>;})}
                  </select>
                </div>
                {tab==="proiezione"&&(
                  <div style={{display:"flex",gap:14,flexWrap:"wrap",alignItems:"flex-end"}}>
                    <div>
                      <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>TRADE DA PROIETTARE</div>
                      <div style={{display:"flex",gap:5}}>
                        {[50,100,200,500,1000].map(function(n){return(
                          <button key={n} onClick={function(){setNProj(n);}} style={{padding:"6px 10px",borderRadius:7,border:"1px solid "+(nProj===n?c.ac:c.bd),background:nProj===n?c.ac+"15":"transparent",color:nProj===n?c.ac:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:nProj===n?700:400}}>{n}</button>
                        );})}
                      </div>
                    </div>
                    <div>
                      <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>SIMULAZIONI</div>
                      <div style={{display:"flex",gap:5}}>
                        {[100,200,500,1000].map(function(n){return(
                          <button key={n} onClick={function(){setNSim(n);}} style={{padding:"6px 10px",borderRadius:7,border:"1px solid "+(nSim===n?c.ac:c.bd),background:nSim===n?c.ac+"15":"transparent",color:nSim===n?c.ac:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:nSim===n?700:400}}>{n}</button>
                        );})}
                      </div>
                    </div>
                    <button onClick={runProiezione} disabled={projLoading||filtered.length<3}
                      style={{padding:"8px 18px",borderRadius:8,border:"none",background:c.ac,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",opacity:projLoading||filtered.length<3?0.5:1}}>
                      {projLoading?"⏳ Calcolo...":"▶ Esegui Proiezione"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ══ TAB STORICO ══ */}
            {tab==="storico"&&(
              <>
                {/* METRICHE SIMULATE VS REALI */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                  {[
                    {l:"SIMULATO",m:simCurrent,eur:simCurrent.totalEur,col:"#0F766E"},
                    {l:"REALE",m:realMetrics,eur:realEur,col:c.txm}
                  ].map(function(block){return(
                    <div key={block.l} style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+(block.l==="SIMULATO"?"#0F766E40":c.bd)}}>
                      <div style={{fontSize:9,fontWeight:700,color:block.col,letterSpacing:"0.08em",marginBottom:10}}>{block.l}</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                        {[
                          {l:"P/L",v:fmtVal(block.m.totalR,block.eur),col:block.m.totalR>=0?"#0F766E":c.rd},
                          {l:"Win Rate",v:block.m.wr+"%",col:block.m.wr>=50?"#0F766E":c.rd},
                          {l:"Profit Factor",v:block.m.pf,col:block.m.pf>=1.5?"#0F766E":block.m.pf>=1?c.am:c.rd},
                          {l:"Expectancy",v:fmtVal(block.m.exp,null),col:block.m.exp>=0?"#0F766E":c.rd},
                          {l:"Max DD",v:"-"+block.m.maxDD+"R",col:c.rd},
                          {l:"Trade",v:block.m.total,col:c.tx}
                        ].map(function(mm,i){return(
                          <div key={i} style={{background:c.bg,borderRadius:7,padding:"7px 9px"}}><div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:2}}>{mm.l}</div><div style={{fontSize:12,fontWeight:700,color:mm.col}}>{mm.v}</div></div>
                        );})}
                      </div>
                    </div>
                  );})}
                </div>
                {/* EQUITY CURVE STORICA */}
                <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <div style={{fontSize:12,fontWeight:700}}>Equity Curve Storica</div>
                    <div style={{display:"flex",gap:10,fontSize:10,color:c.txm}}>
                      <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:12,height:2,background:"#0F766E",display:"inline-block",borderRadius:2}}/> Simulato</span>
                      <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:12,height:2,background:c.txm,display:"inline-block",borderRadius:2,opacity:0.5}}/> Reale</span>
                    </div>
                  </div>
                  {(function(){
                    const curve=simCurrent.curve;
                    const realCurve=buildEquityCurve(filtered,capMap);
                    if(!curve||curve.length<2) return <div style={{height:120,display:"flex",alignItems:"center",justifyContent:"center",color:c.txm,fontSize:11}}>Nessun dato</div>;
                    const W=500; const H=120; const PL=36; const PB=18;
                    const allVals=[...curve.map(function(p){return p.r;}),...realCurve.map(function(p){return p.r;})];
                    const minV=Math.min.apply(null,allVals); const maxV=Math.max.apply(null,allVals);
                    const range=maxV-minV||1; const cH=H-PB; const cW=W-PL;
                    const toX=function(i,len){return PL+(i/(len-1))*cW;};
                    const toY=function(v){return cH-8-((v-minV)/range)*(cH-16);};
                    const simPts=curve.map(function(p,i){return toX(i,curve.length)+","+toY(p.r);}).join(" ");
                    const realPts=realCurve.map(function(p,i){return toX(i,realCurve.length)+","+toY(p.r);}).join(" ");
                    return(
                      <svg width="100%" viewBox={"0 0 "+W+" "+H} style={{overflow:"visible"}}>
                        <text x={PL-3} y={toY(maxV)+3} textAnchor="end" fontSize="8" fill={c.txm}>{maxV>0?"+":""}{maxV}R</text>
                        <text x={PL-3} y={toY(minV)+3} textAnchor="end" fontSize="8" fill={c.txm}>{minV>0?"+":""}{minV}R</text>
                        {minV<0&&maxV>0&&<line x1={PL} y1={toY(0)} x2={W} y2={toY(0)} stroke={c.bd} strokeWidth="1" strokeDasharray="3,3"/>}
                        <polyline points={realPts} fill="none" stroke={c.txm} strokeWidth="1.5" strokeDasharray="4,3" strokeLinejoin="round" opacity="0.5"/>
                        <polyline points={simPts} fill="none" stroke="#0F766E" strokeWidth="2" strokeLinejoin="round"/>
                        <circle cx={toX(curve.length-1,curve.length)} cy={toY(curve[curve.length-1].r)} r="4" fill="#0F766E"/>
                      </svg>
                    );
                  })()}
                </div>
                {/* DISTRIBUZIONE WIN/LOSS SIMULATA */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                  {[{l:"✓ Win",n:simCurrent.wins,tot:simCurrent.total,col:"#0F766E"},{l:"✗ Loss",n:simCurrent.losses,tot:simCurrent.total,col:c.rd},{l:"— BE",n:simCurrent.be,tot:simCurrent.total,col:c.am}].map(function(r,i){
                    const pct=r.tot>0?Math.round((r.n/r.tot)*100):0;
                    return(
                      <div key={i} style={{background:c.card,borderRadius:10,padding:"11px 13px",border:"1px solid "+c.bd}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:11,fontWeight:700,color:r.col}}>{r.l}</span><span style={{fontSize:12,fontWeight:700,color:r.col}}>{pct}%</span></div>
                        <div style={{height:4,borderRadius:3,background:c.bd}}><div style={{height:"100%",width:pct+"%",background:r.col,borderRadius:3}}/></div>
                        <div style={{fontSize:10,color:c.txm,marginTop:4}}>{r.n} trade</div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* ══ TAB PROIEZIONE MONTE CARLO ══ */}
            {tab==="proiezione"&&(
              <>
                {!projData&&!projLoading&&(
                  <div style={{background:c.card,borderRadius:12,padding:"32px 20px",border:"1px solid "+c.bd,textAlign:"center"}}>
                    <div style={{fontSize:28,marginBottom:12}}>🔮</div>
                    <div style={{fontSize:14,fontWeight:700,marginBottom:8}}>Proiezione Monte Carlo</div>
                    <div style={{fontSize:12,color:c.txm,maxWidth:480,margin:"0 auto 20px",lineHeight:1.7}}>
                      Simula {nSim} possibili futuri applicando la tua configurazione attuale (TP {tp}R{be>0?", BE "+be+"R":""}) su {nProj} trade. Mostra il ventaglio di scenari possibili dal peggiore al migliore.
                    </div>
                    {filtered.length<3&&<div style={{fontSize:11,color:c.am,marginBottom:12}}>⚠️ Servono almeno 3 trade con MFE per la proiezione.</div>}
                    <button onClick={runProiezione} disabled={filtered.length<3}
                      style={{padding:"10px 28px",borderRadius:9,border:"none",background:c.ac,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",opacity:filtered.length<3?0.4:1}}>
                      ▶ Esegui Proiezione
                    </button>
                  </div>
                )}
                {projLoading&&(
                  <div style={{background:c.card,borderRadius:12,padding:"40px 20px",border:"1px solid "+c.bd,textAlign:"center"}}>
                    <div style={{fontSize:11,color:c.txm}}>⏳ Calcolo {nSim} simulazioni × {nProj} trade...</div>
                  </div>
                )}
                {projData&&!projLoading&&(function(){
                  const d=projData;
                  const W=520; const H=160; const PL=38; const PB=20;
                  const steps=d.steps;
                  const allV=[...steps.map(function(s){return s.p95;}),...steps.map(function(s){return s.p5;})];
                  const minV=Math.min.apply(null,allV); const maxV=Math.max.apply(null,allV);
                  const range=maxV-minV||1; const cH=H-PB; const cW=W-PL;
                  const toX=function(i){return PL+(i/d.n)*cW;};
                  const toY=function(v){return cH-6-((v-minV)/range)*(cH-12);};
                  const ptP95=steps.map(function(s){return toX(s.i)+","+toY(s.p95);}).join(" ");
                  const ptP75=steps.map(function(s){return toX(s.i)+","+toY(s.p75);}).join(" ");
                  const ptP50=steps.map(function(s){return toX(s.i)+","+toY(s.p50);}).join(" ");
                  const ptP25=steps.map(function(s){return toX(s.i)+","+toY(s.p25);}).join(" ");
                  const ptP5=steps.map(function(s){return toX(s.i)+","+toY(s.p5);}).join(" ");
                  // area p25-p75 (zona centrale)
                  const areaInner=steps.map(function(s){return toX(s.i)+","+toY(s.p75);}).join(" ")+" "+steps.slice().reverse().map(function(s){return toX(s.i)+","+toY(s.p25);}).join(" ");
                  // area p5-p95 (zona esterna)
                  const areaOuter=steps.map(function(s){return toX(s.i)+","+toY(s.p95);}).join(" ")+" "+steps.slice().reverse().map(function(s){return toX(s.i)+","+toY(s.p5);}).join(" ");
                  const acCol=c.ac;
                  const rorCol=d.ruinPct>20?c.rd:d.ruinPct>5?c.am:c.gr;
                  return(
                    <>
                      {/* HEADER con pulsante ricalcola */}
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                        <div>
                          <div style={{fontSize:13,fontWeight:700}}>🔮 Monte Carlo — {d.nsim} simulazioni × {d.n} trade</div>
                          <div style={{fontSize:10,color:c.txm}}>Configurazione: TP {tp}R{be>0?" · BE "+be+"R":""}{stressTest?" · 🧪 Stress Test":""}</div>
                        </div>
                        <button onClick={runProiezione} style={{padding:"6px 14px",borderRadius:7,border:"1px solid "+c.bd,background:c.tag,color:c.tx,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>🔄 Ricalcola</button>
                      </div>

                      {/* FAN CHART */}
                      <div style={{background:c.card,borderRadius:12,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                          <div style={{fontSize:12,fontWeight:700}}>Ventaglio Equity (in R)</div>
                          <div style={{display:"flex",gap:10,fontSize:9,color:c.txm}}>
                            <span style={{display:"flex",alignItems:"center",gap:3}}><span style={{width:10,height:6,background:acCol+"20",border:"1px solid "+acCol+"40",display:"inline-block",borderRadius:2}}/> 25°–75°</span>
                            <span style={{display:"flex",alignItems:"center",gap:3}}><span style={{width:10,height:6,background:acCol+"08",border:"1px solid "+acCol+"20",display:"inline-block",borderRadius:2}}/> 5°–95°</span>
                            <span style={{display:"flex",alignItems:"center",gap:3}}><span style={{width:12,height:2,background:acCol,display:"inline-block",borderRadius:2}}/> Mediana</span>
                          </div>
                        </div>
                        <svg width="100%" viewBox={"0 0 "+W+" "+H} style={{overflow:"visible"}}>
                          <text x={PL-3} y={toY(maxV)+3} textAnchor="end" fontSize="8" fill={c.txm}>{maxV>0?"+":""}{maxV.toFixed(1)}R</text>
                          <text x={PL-3} y={toY(0)+3} textAnchor="end" fontSize="8" fill={c.txm}>0</text>
                          <text x={PL-3} y={toY(minV)+3} textAnchor="end" fontSize="8" fill={c.txm}>{minV.toFixed(1)}R</text>
                          {minV<0&&maxV>0&&<line x1={PL} y1={toY(0)} x2={W} y2={toY(0)} stroke={c.rd} strokeWidth="1" strokeDasharray="3,3" opacity="0.4"/>}
                          {/* assi */}
                          <line x1={PL} y1={8} x2={PL} y2={cH} stroke={c.bd} strokeWidth="1"/>
                          <line x1={PL} y1={cH} x2={W} y2={cH} stroke={c.bd} strokeWidth="1"/>
                          {/* label trade */}
                          {[0,Math.floor(d.n/4),Math.floor(d.n/2),Math.floor(d.n*3/4),d.n].map(function(v){return(
                            <text key={v} x={toX(v)} y={H-4} textAnchor="middle" fontSize="7" fill={c.txm}>{v}</text>
                          );})}
                          {/* area esterna 5-95 */}
                          <polygon points={areaOuter} fill={acCol} fillOpacity="0.06" stroke="none"/>
                          {/* area interna 25-75 */}
                          <polygon points={areaInner} fill={acCol} fillOpacity="0.18" stroke="none"/>
                          {/* linee percentili */}
                          <polyline points={ptP95} fill="none" stroke={acCol} strokeWidth="1" strokeDasharray="3,3" opacity="0.4"/>
                          <polyline points={ptP5} fill="none" stroke={acCol} strokeWidth="1" strokeDasharray="3,3" opacity="0.4"/>
                          <polyline points={ptP75} fill="none" stroke={acCol} strokeWidth="1.2" opacity="0.6"/>
                          <polyline points={ptP25} fill="none" stroke={acCol} strokeWidth="1.2" opacity="0.6"/>
                          {/* mediana */}
                          <polyline points={ptP50} fill="none" stroke={acCol} strokeWidth="2.2" strokeLinejoin="round"/>
                          {/* dot finale mediana */}
                          <circle cx={toX(d.n)} cy={toY(d.p50)} r="4" fill={acCol}/>
                        </svg>
                      </div>

                      {/* PERCENTILI FINALI */}
                      <div style={{background:c.card,borderRadius:12,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
                        <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Distribuzione Risultati Finali (dopo {d.n} trade)</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6}}>
                          {[{l:"Scenario Pessimo",sub:"5° percentile",v:d.p5,icon:"😱"},{l:"Sotto Media",sub:"25° percentile",v:d.p25,icon:"😟"},{l:"Mediana",sub:"50° percentile",v:d.p50,icon:"😐"},{l:"Sopra Media",sub:"75° percentile",v:d.p75,icon:"😊"},{l:"Scenario Ottimo",sub:"95° percentile",v:d.p95,icon:"🚀"}].map(function(p,i){
                            const col=p.v>0?c.gr:p.v<-2?c.rd:c.am;
                            return(
                              <div key={i} style={{background:c.bg,borderRadius:9,padding:"10px",textAlign:"center",border:"1px solid "+c.bd}}>
                                <div style={{fontSize:16,marginBottom:4}}>{p.icon}</div>
                                <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:2,lineHeight:1.3}}>{p.l}</div>
                                <div style={{fontSize:14,fontWeight:800,color:col}}>{p.v>0?"+":""}{p.v}R</div>
                                <div style={{fontSize:8,color:c.txs}}>{p.sub}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* STATISTICHE RISCHIO */}
                      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
                        {[
                          {l:"Risk of Ruin",v:d.ruinPct+"%",sub:"sim. < -5R",col:rorCol,icon:"💀"},
                          {l:"DD Medio",v:"-"+d.avgDD+"R",sub:"drawdown atteso",col:c.am,icon:"📉"},
                          {l:"Max Loss Streak",v:d.avgMaxLoss,sub:"perdite consec. medie",col:c.rd,icon:"🔴"},
                          {l:"Expectancy Sim.",v:(d.expSim>0?"+":"")+d.expSim+"R",sub:"per trade",col:d.expSim>=0?c.gr:c.rd,icon:"📊"}
                        ].map(function(s,i){return(
                          <div key={i} style={{background:c.card,borderRadius:10,padding:"12px",border:"1px solid "+c.bd,textAlign:"center"}}>
                            <div style={{fontSize:18,marginBottom:4}}>{s.icon}</div>
                            <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:4}}>{s.l}</div>
                            <div style={{fontSize:16,fontWeight:800,color:s.col}}>{s.v}</div>
                            <div style={{fontSize:8,color:c.txs,marginTop:2}}>{s.sub}</div>
                          </div>
                        );})}
                      </div>

                      {/* MESSAGGIO INTERPRETATIVO */}
                      {(function(){
                        const msg=[];
                        if(d.p50>0) msg.push({t:"📈 Profittabile nel caso mediano: +"+d.p50+"R su "+d.n+" trade.",c:c.gr});
                        else msg.push({t:"⚠️ Nel caso mediano sei in perdita ("+d.p50+"R). Rivedi la configurazione.",c:c.rd});
                        if(d.ruinPct>15) msg.push({t:"💀 Risk of ruin alto ("+d.ruinPct+"%). Considera di ridurre la size o migliorare la strategia.",c:c.rd});
                        else if(d.ruinPct<3) msg.push({t:"✅ Risk of ruin molto basso ("+d.ruinPct+"%). La strategia è robusta.",c:c.gr});
                        const spread=d.p95-d.p5;
                        if(spread>d.n*0.5) msg.push({t:"📊 Alta varianza: spread 5°–95° = "+spread.toFixed(1)+"R. Aumenta il campione di trade storici per stime più precise.",c:c.am});
                        return msg.length>0?(
                          <div style={{display:"flex",flexDirection:"column",gap:6}}>
                            {msg.map(function(m,i){return(
                              <div key={i} style={{background:m.c+"10",borderRadius:9,padding:"9px 13px",border:"1px solid "+m.c+"25",fontSize:11,color:m.c,fontWeight:500}}>{m.t}</div>
                            );})}
                          </div>
                        ):null;
                      })()}
                    </>
                  );
                })()}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── SIM CAPITALE ─────────────────────────────────────────────────────────────
function SimCapitale({c,trades,strategie,conti}){
  const [selConti,setSelConti]=useState([]);
  const [selStrat,setSelStrat]=useState([]);
  const [capitale,setCapitale]=useState("10000");
  const [rischio,setRischio]=useState("1");
  const [modo,setModo]=useState("fisso");
  const [unit,setUnit]=useState("$");

  function toggleC(id){setSelConti(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  function toggleS(id){setSelStrat(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}

  const filtered=trades.filter(function(t){
    if(selConti.length>0&&!selConti.includes(t.conto_id)) return false;
    if(selStrat.length>0&&!selStrat.includes(t.strategia_id)) return false;
    return true;
  }).sort(function(a,b){return new Date(a.data_apertura)-new Date(b.data_apertura);});

  function simulate(tradeList,cap0,riskPct,compound){
    let cap=cap0; const curve=[{i:0,v:cap0}]; let peak=cap0,maxDD=0,maxDDpct=0;
    let curW=0,curL=0,maxW=0,maxL=0;
    tradeList.forEach(function(t,i){
      const base=compound?cap:cap0;
      const riskAmt=base*(riskPct/100);
      const gain=riskAmt*t.r_result;
      cap+=gain;
      curve.push({i:i+1,v:parseFloat(cap.toFixed(2))});
      if(cap>peak){peak=cap;}
      const dd=peak-cap; const ddPct=peak>0?(dd/peak)*100:0;
      if(dd>maxDD){maxDD=dd;maxDDpct=ddPct;}
      if(t.r_result>0){curW++;curL=0;if(curW>maxW)maxW=curW;}
      else if(t.r_result<0){curL++;curW=0;if(curL>maxL)maxL=curL;}
      else{curW=0;curL=0;}
    });
    return {curve,final:parseFloat(cap.toFixed(2)),profit:parseFloat((cap-cap0).toFixed(2)),profitPct:parseFloat(((cap-cap0)/cap0*100).toFixed(2)),maxDD:parseFloat(maxDD.toFixed(2)),maxDDpct:parseFloat(maxDDpct.toFixed(2)),maxW,maxL};
  }

  const cap0=parseFloat(capitale)||10000;
  const rsk=parseFloat(rischio)||1;

  const sim=filtered.length>0?simulate(filtered,cap0,rsk,modo==="compound"):null;
  // scenari: ottimistico (+20% rischio), pessimistico (-20% rischio, solo win)
  const simOtt=filtered.length>0?simulate(filtered,cap0,rsk*1.2,modo==="compound"):null;
  const simPess=filtered.length>0?simulate(filtered.map(function(t){return {...t,r_result:t.r_result<0?t.r_result*1.3:t.r_result*0.8};}),cap0,rsk,modo==="compound"):null;

  function fmtEur(v){return (v>=0?"+":"")+"$"+Math.abs(v).toLocaleString("it-IT",{minimumFractionDigits:0,maximumFractionDigits:0});}
  function fmtPct(v){return (v>=0?"+":"")+v.toFixed(1)+"%";}
  function dispVal(v,pct){return unit==="$"?fmtEur(v):unit==="%"?fmtPct(pct):fmtR(pct/100*2);}

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <ModuleHeader
        title="Simulatore Capitale"
        subtitle={filtered.length+" trade nel campione"}
        tooltip="Il Simulatore Capitale ti mostra come sarebbe cresciuto (o sceso) il tuo conto se avessi usato una gestione del rischio precisa e costante — ad esempio rischiando sempre l'1% o il 2% per trade. In modalità Composta il rischio si ricalcola sul capitale aggiornato dopo ogni trade, amplificando sia i guadagni che le perdite. In modalità Fissa usi sempre la stessa size in valore assoluto. Confronta la curva simulata con quella reale per capire se il tuo sizing attuale è ottimale. Mostra 3 scenari (base, ottimistico, prudente) con equity curve, drawdown e risultato finale. I risultati sono basati su performance passate: non garantiscono risultati futuri."
        c={c}
        right={
          <div style={{display:"flex",gap:2,background:c.tag,borderRadius:8,padding:2}}>
            {["$","%","R"].map(function(u){return <button key={u} onClick={function(){setUnit(u);}} style={{padding:"4px 10px",borderRadius:6,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:unit===u?700:400,background:unit===u?c.ac:"transparent",color:unit===u?"#fff":c.txm}}>{u}</button>;})}
          </div>
        }
      />
      <div style={{padding:"10px 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:16,flexShrink:0,flexWrap:"wrap"}}>
        <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>CONTI</div><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{conti.map(function(cn){const s=selConti.includes(cn.id);return <button key={cn.id} onClick={function(){toggleC(cn.id);}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(s?c.ac:c.bd),background:s?c.ac+"15":"transparent",color:s?c.ac:c.txm,fontSize:11,fontWeight:s?700:400,cursor:"pointer",fontFamily:"inherit"}}>{cn.nome}</button>;})}</div></div>
        <div style={{width:1,background:c.bd}}/>
        <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>STRATEGIE</div><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{strategie.map(function(s){const sel=selStrat.includes(s.id);return <button key={s.id} onClick={function(){toggleS(s.id);}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(sel?c.ac:c.bd),background:sel?c.ac+"15":"transparent",color:sel?c.ac:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{s.nome}</button>;})}</div></div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        <DisclaimerCampione n={filtered.length} c={c}/>
        <div style={{background:c.card,borderRadius:11,padding:"13px 16px",border:"1px solid "+c.bd,marginBottom:12,display:"flex",gap:16,alignItems:"flex-end",flexWrap:"wrap"}}>
          <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>CAPITALE INIZIALE ($)</div><input value={capitale} onChange={function(e){setCapitale(e.target.value);}} style={{padding:"7px 10px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:13,fontFamily:"inherit",outline:"none",width:120}}/></div>
          <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>RISCHIO PER TRADE (%)</div><input value={rischio} onChange={function(e){setRischio(e.target.value);}} style={{padding:"7px 10px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:13,fontFamily:"inherit",outline:"none",width:80}}/></div>
          <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>MODALITÀ</div><div style={{display:"flex",gap:6}}>{[{v:"fisso",l:"Fisso"},{v:"compound",l:"Compound"}].map(function(m){const a=modo===m.v;return <button key={m.v} onClick={function(){setModo(m.v);}} style={{padding:"6px 14px",borderRadius:8,border:"1px solid "+(a?c.ac:c.bd),background:a?c.ac+"15":"transparent",color:a?c.ac:c.txm,fontSize:12,fontWeight:a?700:400,cursor:"pointer",fontFamily:"inherit"}}>{m.l}</button>;})}</div></div>
        </div>
        {!sim?(
          <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Nessun trade nel campione.</div>
        ):(
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
              {[
                {l:"🎯 Base",s:sim,col:c.ac},
                {l:"📈 Ottimistico (+20% size)",s:simOtt,col:c.gr},
                {l:"📉 Pessimistico",s:simPess,col:c.rd}
              ].map(function(sc){return(
                <div key={sc.l} style={{background:c.card,borderRadius:11,padding:"12px 14px",border:"1px solid "+(sc.col+"40")}}>
                  <div style={{fontSize:10,fontWeight:700,color:sc.col,marginBottom:8}}>{sc.l}</div>
                  <div style={{fontSize:20,fontWeight:800,color:sc.s.profit>=0?c.gr:c.rd,marginBottom:4}}>{fmtEur(sc.s.profit)}</div>
                  <div style={{fontSize:11,color:sc.s.profitPct>=0?c.gr:c.rd,fontWeight:600,marginBottom:8}}>{fmtPct(sc.s.profitPct)}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
                    {[{l:"Capitale Finale",v:"$"+sc.s.final.toLocaleString("it-IT",{maximumFractionDigits:0}),tt:"Il tuo capitale al termine di tutti i trade nel campione, applicando il sizing simulato. Se è maggiore del capitale reale, questo sizing avrebbe fatto meglio di come hai operato realmente."},{l:"Max DD",v:"−$"+sc.s.maxDD.toLocaleString("it-IT",{maximumFractionDigits:0})+" ("+sc.s.maxDDpct.toFixed(1)+"%)",tt:"La perdita massima dal picco al minimo con questo sizing. Un sizing aggressivo produce più profitto ma anche drawdown più profondi — valuta se psicologicamente potresti reggere questo drawdown senza smettere di tradare."},{l:"Max Win Streak",v:sc.s.maxW,tt:"Il numero massimo di trade vincenti consecutivi con questo sizing. Ti dà un'idea dei periodi di euforia che potresti vivere — attenzione a non aumentare la size durante le serie positive."},{l:"Max Loss Streak",v:sc.s.maxL,tt:"Il numero massimo di trade perdenti consecutivi con questo sizing. Questo è il momento più duro da superare psicologicamente — avere una regola di stop preventiva per le serie negative è fondamentale."}].map(function(f,i){return(
                      <div key={i} style={{background:c.bg,borderRadius:6,padding:"6px 8px"}}><div style={{fontSize:8,color:c.txm,fontWeight:600,display:"flex",alignItems:"center",gap:2}}>{f.l}{f.tt&&<Tooltip c={c} text={f.tt}/>}</div><div style={{fontSize:11,fontWeight:700,color:c.tx}}>{f.v}</div></div>
                    );})}
                  </div>
                </div>
              );})}
            </div>
            {(function(){
              const curves=[{curve:sim.curve,col:c.ac,label:"Base"},{curve:simOtt.curve,col:c.gr,label:"Ottimistico"},{curve:simPess.curve,col:c.rd,label:"Pessimistico"}];
              const allV=curves.flatMap(function(sc){return sc.curve.map(function(p){return p.v;});});
              const minV=Math.min.apply(null,allV); const maxV=Math.max.apply(null,allV);
              const W=500,H=140,PL=56,PB=18;
              const cH=H-PB; const cW=W-PL;
              const toX=function(i,len){return PL+(i/(Math.max(len-1,1)))*cW;};
              const toY=function(v){return cH-8-((v-minV)/(maxV-minV||1))*(cH-16);};
              return(
                <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <div style={{fontSize:12,fontWeight:700}}>Equity Curve — Tutti gli Scenari</div>
                    <div style={{display:"flex",gap:10}}>
                      {curves.map(function(sc){return <span key={sc.label} style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:c.txm}}><span style={{width:12,height:2,background:sc.col,display:"inline-block",borderRadius:2}}/>{sc.label}</span>;})}
                    </div>
                  </div>
                  <svg width="100%" viewBox={"0 0 "+W+" "+H} style={{overflow:"visible"}}>
                    {[minV,(minV+maxV)/2,maxV].map(function(v,i){return(
                      <g key={i}>
                        <line x1={PL} y1={toY(v)} x2={W} y2={toY(v)} stroke={c.bd} strokeWidth="0.5" strokeDasharray="3,3"/>
                        <text x={PL-3} y={toY(v)+3} textAnchor="end" fontSize="8" fill={c.txm}>${Math.round(v).toLocaleString("it-IT")}</text>
                      </g>
                    );})}
                    {[0,Math.floor((sim.curve.length-1)/2),sim.curve.length-1].map(function(i){return <text key={i} x={toX(i,sim.curve.length)} y={H-3} textAnchor="middle" fontSize="7" fill={c.txm}>{i}</text>;})}
                    {curves.map(function(sc){const pts=sc.curve.map(function(p,i){return toX(i,sc.curve.length)+","+toY(p.v);}).join(" ");return <polyline key={sc.label} points={pts} fill="none" stroke={sc.col} strokeWidth="2" strokeLinejoin="round"/>;})}
                  </svg>
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}

// ── MONTE CARLO ───────────────────────────────────────────────────────────────
function MonteCarlo({c,trades,strategie,conti}){
  const {ModalRenderer}=useModal();
  const [selConti,setSelConti]=useState([]);
  const [selStrat,setSelStrat]=useState([]);
  const [capitale,setCapitale]=useState("10000");
  const [rischio,setRischio]=useState("1");
  const [nTrade,setNTrade]=useState(100);
  const [nSim,setNSim]=useState(500);
  const [ruinPct,setRuinPct]=useState(20);
  const [running,setRunning]=useState(false);
  const [results,setResults]=useState(null);
  const [showTooltip,setShowTooltip]=useState(false);

  function toggleC(id){setSelConti(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  function toggleS(id){setSelStrat(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}

  const filtered=trades.filter(function(t){
    if(selConti.length>0&&!selConti.includes(t.conto_id)) return false;
    if(selStrat.length>0&&!selStrat.includes(t.strategia_id)) return false;
    return true;
  });

  function runMC(){
    if(filtered.length===0) return;
    setRunning(true);
    setTimeout(function(){
      const cap0=parseFloat(capitale)||10000;
      const rsk=parseFloat(rischio)||1;
      const ruinThresh=cap0*(1-ruinPct/100);
      const rDist=filtered.map(function(t){return t.r_result;});
      const simResults=[];
      const sampleCurves=[];
      for(let s=0;s<nSim;s++){
        let cap=cap0; let peak=cap0; let maxDD=0; let maxW=0,maxL=0,curW=0,curL=0;
        let ruined=false;
        const curve=[cap0];
        for(let i=0;i<nTrade;i++){
          const r=rDist[Math.floor(Math.random()*rDist.length)];
          const gain=(cap*rsk/100)*r;
          cap+=gain;
          curve.push(parseFloat(cap.toFixed(2)));
          if(cap>peak)peak=cap;
          const dd=(peak-cap)/peak*100;
          if(dd>maxDD)maxDD=dd;
          if(r>0){curW++;curL=0;if(curW>maxW)maxW=curW;}
          else if(r<0){curL++;curW=0;if(curL>maxL)maxL=curL;}
          else{curW=0;curL=0;}
          if(cap<=ruinThresh)ruined=true;
        }
        simResults.push({final:parseFloat(cap.toFixed(2)),maxDD:parseFloat(maxDD.toFixed(1)),maxW,maxL,ruined,profit:parseFloat((cap-cap0).toFixed(2))});
        if(s<80) sampleCurves.push(curve);
      }
      simResults.sort(function(a,b){return a.final-b.final;});
      const finals=simResults.map(function(r){return r.final;});
      function perc(arr,p){return arr[Math.floor(arr.length*(p/100))];}
      const p5=perc(finals,5),p25=perc(finals,25),p50=perc(finals,50),p75=perc(finals,75),p95=perc(finals,95);
      const avgFinal=parseFloat((finals.reduce(function(s,v){return s+v;},0)/finals.length).toFixed(2));
      const avgDD=parseFloat((simResults.reduce(function(s,r){return s+r.maxDD;},0)/simResults.length).toFixed(1));
      const ruin=parseFloat((simResults.filter(function(r){return r.ruined;}).length/nSim*100).toFixed(1));
      const avgMaxL=parseFloat((simResults.reduce(function(s,r){return s+r.maxL;},0)/simResults.length).toFixed(1));
      setResults({finals,sampleCurves,p5,p25,p50,p75,p95,avgFinal,avgDD,ruin,avgMaxL,cap0,nTrade});
      setRunning(false);
    },50);
  }

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <ModuleHeader
        title="Monte Carlo"
        subtitle={filtered.length+" trade nel campione"}
        tooltip="Il Monte Carlo esegue migliaia di simulazioni rimescolando casualmente i tuoi trade storici per mostrarti la gamma di possibili futuri del tuo conto. Ti risponde a domande come: qual è la probabilità di andare in drawdown del 20%? Qual è il peggior scenario realistico con questa strategia? Quanto posso aspettarmi di guadagnare nei prossimi 100 trade? Il Fan Chart mostra tutte le traiettorie possibili — più le linee sono sparse, più il tuo sistema è volatile. Il Risk of Ruin indica la percentuale di simulazioni che portano il conto sotto zero o sotto una soglia critica — tienilo il più basso possibile."
        c={c}
      />
      <div style={{padding:"10px 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:16,flexShrink:0,flexWrap:"wrap"}}>
        <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>CONTI</div><div style={{display:"flex",gap:5}}>{conti.map(function(cn){const s=selConti.includes(cn.id);return <button key={cn.id} onClick={function(){toggleC(cn.id);}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(s?c.ac:c.bd),background:s?c.ac+"15":"transparent",color:s?c.ac:c.txm,fontSize:11,fontWeight:s?700:400,cursor:"pointer",fontFamily:"inherit"}}>{cn.nome}</button>;})}</div></div>
        <div style={{width:1,background:c.bd}}/>
        <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>STRATEGIE</div><div style={{display:"flex",gap:5}}>{strategie.map(function(s){const sel=selStrat.includes(s.id);return <button key={s.id} onClick={function(){toggleS(s.id);}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(sel?c.ac:c.bd),background:sel?c.ac+"15":"transparent",color:sel?c.ac:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{s.nome}</button>;})}</div></div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        <DisclaimerCampione n={filtered.length} c={c}/>
        <div style={{background:c.card,borderRadius:11,padding:"13px 16px",border:"1px solid "+c.bd,marginBottom:12,display:"flex",gap:14,alignItems:"flex-end",flexWrap:"wrap"}}>
          {[{l:"CAPITALE ($)",v:capitale,set:setCapitale,w:100},{l:"RISCHIO %",v:rischio,set:setRischio,w:70}].map(function(f){return(
            <div key={f.l}><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>{f.l}</div><input value={f.v} onChange={function(e){f.set(e.target.value);}} style={{padding:"7px 10px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",width:f.w}}/></div>
          );})}
          <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>TRADE DA SIMULARE</div><div style={{display:"flex",gap:5}}>{[50,100,200,500].map(function(n){return <button key={n} onClick={function(){setNTrade(n);}} style={{padding:"5px 9px",borderRadius:7,border:"1px solid "+(nTrade===n?c.ac:c.bd),background:nTrade===n?c.ac+"15":"transparent",color:nTrade===n?c.ac:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:nTrade===n?700:400}}>{n}</button>;})}</div></div>
          <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>SIMULAZIONI</div><div style={{display:"flex",gap:5}}>{[100,500,1000].map(function(n){return <button key={n} onClick={function(){setNSim(n);}} style={{padding:"5px 9px",borderRadius:7,border:"1px solid "+(nSim===n?c.ac:c.bd),background:nSim===n?c.ac+"15":"transparent",color:nSim===n?c.ac:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:nSim===n?700:400}}>{n}</button>;})}</div></div>
          <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>SOGLIA RUIN (%DD)</div><div style={{display:"flex",gap:5}}>{[10,20,30,50].map(function(n){return <button key={n} onClick={function(){setRuinPct(n);}} style={{padding:"5px 9px",borderRadius:7,border:"1px solid "+(ruinPct===n?c.rd:c.bd),background:ruinPct===n?c.rd+"15":"transparent",color:ruinPct===n?c.rd:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:ruinPct===n?700:400}}>{n}%</button>;})}</div></div>
          <button onClick={runMC} disabled={running||filtered.length===0} style={{padding:"8px 20px",borderRadius:8,background:filtered.length===0?"#6366F150":"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{running?"⏳ Calcolo...":"▶ Avvia"}</button>
        </div>

        {results&&(
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:12}}>
              {[
                {l:"Capitale Medio Finale",v:"$"+results.avgFinal.toLocaleString("it-IT",{maximumFractionDigits:0}),col:results.avgFinal>=results.cap0?c.gr:c.rd,tt:"Il capitale medio con cui finisci attraverso tutte le simulazioni. Se è sopra il capitale iniziale la tua strategia è mediamente profittevole. È la tua aspettativa realistica più probabile, ma ricorda che metà delle simulazioni finisce sotto questo valore e metà sopra."},
                {l:"Max DD Medio",v:"-"+results.avgDD+"%",col:c.rd,tt:"Il drawdown massimo medio che subisci nelle simulazioni — cioè la perdita più grande dal picco al minimo prima del recupero. In media, anche con una strategia vincente, subirai questa perdita prima di tornare ai massimi. Prepara la tua psicologia a sopportarla senza abbandonare la strategia."},
                {l:"Risk of Ruin",v:results.ruin+"%",col:results.ruin>10?c.rd:results.ruin>5?c.am:c.gr,tt:"La percentuale di simulazioni in cui il conto scende sotto la soglia di ruin che hai impostato (default 20% di perdita). Se è 5% significa che in 5 casi su 100 la tua strategia porta a perdite devastanti. Sotto il 2% è accettabile. Sopra il 10% dovresti ridurre il rischio per trade o rivedere la strategia."},
                {l:"Max Loss Streak Medio",v:results.avgMaxL,col:c.am,tt:"Il numero medio di trade perdenti consecutivi nelle simulazioni. Anche con una strategia vincente, avrai periodi di perdite consecutive — questo numero ti dice quante ne devi aspettare in media nel peggior momento. Usalo per calibrare la tua regola di stop: se arrivi a N perdite consecutive, fai una pausa e analizza."},
                {l:"Scenario Peggiore",v:"$"+results.finals[0].toLocaleString("it-IT",{maximumFractionDigits:0}),col:c.rd,tt:"Il capitale finale nella simulazione andata peggio tra tutte quelle eseguite. Non significa che accadrà sicuramente, ma è il worst case realistico basato sui tuoi dati storici. Se questo numero ti spaventa troppo, considera di ridurre il rischio per trade o di fermarti prima al raggiungimento di uno stop loss mensile."}
              ].map(function(m,i){return(
                <div key={i} style={{background:c.card,borderRadius:10,padding:"11px 12px",border:"1px solid "+c.bd}}>
                  <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:3,display:"flex",alignItems:"center",gap:2}}>{m.l}<Tooltip c={c} text={m.tt}/></div>
                  <div style={{fontSize:14,fontWeight:700,color:m.col}}>{m.v}</div>
                </div>
              );})}
            </div>

            {/* PERCENTILI con tooltip */}
            <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <div style={{fontSize:12,fontWeight:700}}>Distribuzione Percentili</div>
                <div style={{position:"relative"}}>
                  <button onMouseEnter={function(){setShowTooltip(true);}} onMouseLeave={function(){setShowTooltip(false);}} style={{width:18,height:18,borderRadius:"50%",border:"1px solid "+c.bd,background:c.tag,color:c.txm,fontSize:10,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>?</button>
                  {showTooltip&&(
                    <div style={{position:"absolute",left:"calc(100% + 8px)",top:"50%",transform:"translateY(-50%)",background:c.card,border:"1px solid "+c.bd,borderRadius:9,padding:"10px 12px",width:260,zIndex:200,boxShadow:"0 8px 24px rgba(0,0,0,0.15)"}}>
                      <div style={{fontSize:11,fontWeight:700,marginBottom:6}}>Cosa sono i percentili?</div>
                      <div style={{fontSize:10,color:c.txm,lineHeight:1.6}}>Su {nSim} simulazioni casuali dei tuoi trade:<br/><b style={{color:c.rd}}>5°</b> = nel 5% dei casi peggiori finisci qui<br/><b style={{color:c.am}}>25°</b> = scenario sfavorevole<br/><b style={{color:c.tx}}>50°</b> = risultato mediano (metà sopra, metà sotto)<br/><b style={{color:c.ac}}>75°</b> = scenario favorevole<br/><b style={{color:c.gr}}>95°</b> = nel 5% dei casi migliori finisci qui</div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6}}>
                {[{l:"5° percentile",v:results.p5,col:c.rd},{l:"25° percentile",v:results.p25,col:c.am},{l:"50° (mediana)",v:results.p50,col:c.tx},{l:"75° percentile",v:results.p75,col:c.ac},{l:"95° percentile",v:results.p95,col:c.gr}].map(function(p,i){return(
                  <div key={i} style={{background:c.bg,borderRadius:8,padding:"10px 12px",border:"1px solid "+(p.col+"30"),textAlign:"center"}}>
                    <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:3}}>{p.l}</div>
                    <div style={{fontSize:13,fontWeight:700,color:p.col}}>${p.v.toLocaleString("it-IT",{maximumFractionDigits:0})}</div>
                    <div style={{fontSize:9,color:p.v>=results.cap0?c.gr:c.rd}}>{p.v>=results.cap0?"+":""}{((p.v-results.cap0)/results.cap0*100).toFixed(1)}%</div>
                  </div>
                );})}
              </div>
            </div>

            {/* FAN CHART */}
            {(function(){
              const W=500,H=150,PL=56,PB=18;
              const cH=H-PB; const cW=W-PL;
              const allV=results.sampleCurves.flatMap(function(cv){return cv;});
              const minV=Math.min.apply(null,allV); const maxV=Math.max.apply(null,allV);
              const toX=function(i,len){return PL+(i/(Math.max(len-1,1)))*cW;};
              const toY=function(v){return cH-8-((v-minV)/(maxV-minV||1))*(cH-16);};
              const percCurves=[[results.p5],[results.p25],[results.p50],[results.p75],[results.p95]].map(function(p){return p[0];});
              return(
                <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd}}>
                  <div style={{fontSize:12,fontWeight:700,marginBottom:10,display:"flex",alignItems:"center",gap:4}}>Fan Chart — {results.sampleCurves.length} simulazioni campione + percentili<Tooltip c={c} text="Questo grafico mostra migliaia di possibili futuri del tuo conto, simulati mescolando casualmente i tuoi trade storici. Ogni linea sottile è una possibile traiettoria. Le linee colorate mostrano i percentili: la linea rossa è il 5° percentile (le cose vanno male nel 95% dei casi meglio di così), la linea verde è il 95° percentile (le cose vanno bene), la linea grigia è la mediana (risultato più probabile). Più le linee sono sparse, più il tuo trading è volatile e imprevedibile."/></div>
                  <svg width="100%" viewBox={"0 0 "+W+" "+H} style={{overflow:"visible"}}>
                    {[minV,(minV+maxV)/2,maxV].map(function(v,i){return <text key={i} x={PL-3} y={toY(v)+3} textAnchor="end" fontSize="8" fill={c.txm}>${Math.round(v).toLocaleString("it-IT")}</text>;})}
                    {results.cap0!==undefined&&minV<results.cap0&&maxV>results.cap0&&<line x1={PL} y1={toY(results.cap0)} x2={W} y2={toY(results.cap0)} stroke={c.bd} strokeWidth="1" strokeDasharray="4,3"/>}
                    {results.sampleCurves.map(function(cv,si){const pts=cv.map(function(v,i){return toX(i,cv.length)+","+toY(v);}).join(" ");return <polyline key={si} points={pts} fill="none" stroke={c.ac} strokeWidth="0.8" strokeLinejoin="round" opacity="0.12"/>;})}
                    {[{p:results.p5,col:c.rd},{p:results.p95,col:c.gr},{p:results.p50,col:c.tx}].map(function(pk,i){
                      const idx=results.finals.indexOf(pk.p);
                      if(idx<0||!results.sampleCurves[Math.min(idx,results.sampleCurves.length-1)]) return null;
                      const cv=results.sampleCurves[Math.min(Math.floor(idx/nSim*results.sampleCurves.length),results.sampleCurves.length-1)];
                      const pts=cv.map(function(v,i){return toX(i,cv.length)+","+toY(v);}).join(" ");
                      return <polyline key={i} points={pts} fill="none" stroke={pk.col} strokeWidth="2" strokeLinejoin="round"/>;
                    })}
                  </svg>
                </div>
              );
            })()}
          </>
        )}
        {!results&&!running&&filtered.length>0&&(
          <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Configura i parametri e clicca ▶ Avvia per eseguire la simulazione.</div>
        )}
      </div>
      <ModalRenderer c={c}/>
    </div>
  );
}

// ── GENINISGHTS (calcolo statistico puro) ─────────────────────────────────────
function genInsights(filtered,strategie){
  const ins=[];
  if(!filtered||filtered.length<5) return ins;
  const m=calcMetrics(filtered);
  // ── EMOZIONI ──
  const moods=["😌 Calmo","😐 Neutro","😰 Ansioso","😤 Frustrato","😵 Euforico","😴 Stanco"];
  const moodData=moods.map(function(mood){
    const mt=filtered.filter(function(t){return t.mood===mood;});
    if(mt.length<2) return null;
    const mm=calcMetrics(mt);
    return {mood,n:mt.length,exp:mm.exp,wr:mm.wr};
  }).filter(Boolean);
  if(moodData.length>=2){
    const calmo=moodData.find(function(d){return d.mood==="😌 Calmo";});
    const ansioso=moodData.find(function(d){return d.mood==="😰 Ansioso";});
    const frustrato=moodData.find(function(d){return d.mood==="😤 Frustrato";});
    const stanco=moodData.find(function(d){return d.mood==="😴 Stanco";});
    if(calmo&&ansioso&&calmo.exp-ansioso.exp>0.3)
      ins.push({type:"alert",cat:"😰 EMOZIONI",col:"#DC2626",text:"Quando sei Ansioso: WR "+ansioso.wr+"%, Exp "+fmtR(ansioso.exp)+" | Quando sei Calmo: WR "+calmo.wr+"%, Exp "+fmtR(calmo.exp)+". Differenza di "+parseFloat((calmo.exp-ansioso.exp).toFixed(2))+"R per trade. Considera di non tradare quando sei ansioso."});
    if(frustrato&&frustrato.exp<-0.3)
      ins.push({type:"alert",cat:"😤 FRUSTRAZIONE",col:"#DC2626",text:"Quando sei Frustrato il tuo Exp è "+fmtR(frustrato.exp)+" su "+frustrato.n+" trade. Evita il trading in questo stato."});
    if(stanco&&stanco.exp<0)
      ins.push({type:"alert",cat:"😴 STANCHEZZA",col:"#D97706",text:"Quando sei Stanco il tuo Exp è "+fmtR(stanco.exp)+" su "+stanco.n+" trade. Il trading sotto stanchezza ti costa R."});
    if(calmo&&calmo.wr>=65)
      ins.push({type:"positive",cat:"😌 CALMO",col:"#16A34A",text:"Quando sei Calmo raggiungi WR "+calmo.wr+"% su "+calmo.n+" trade. Il tuo edge è massimo in questo stato."});
  }
  // ── TILT (streak) ──
  const sorted=filtered.slice().sort(function(a,b){return new Date(a.data_apertura)-new Date(b.data_apertura);});
  let streak=0,maxStreak=0;
  sorted.forEach(function(t){if(t.r_result<0){streak++;if(streak>maxStreak)maxStreak=streak;}else streak=0;});
  const afterLoss2=[];
  for(let i=2;i<sorted.length;i++){
    if(sorted[i-1].r_result<0&&sorted[i-2].r_result<0) afterLoss2.push({r:sorted[i].r_result,voto:sorted[i].sc_esecuzione});
  }
  if(afterLoss2.length>=2){
    const avgR=parseFloat((afterLoss2.reduce(function(s,t){return s+t.r;},0)/afterLoss2.length).toFixed(2));
    const votiOk=afterLoss2.filter(function(t){return t.voto!=null;});
    const avgV=votiOk.length>0?parseFloat((votiOk.reduce(function(s,t){return s+t.voto;},0)/votiOk.length).toFixed(1)):null;
    if(avgR<0) ins.push({type:"alert",cat:"⚡ TILT",col:"#DC2626",text:"Dopo 2 loss consecutive hai fatto "+afterLoss2.length+" trade con R medio "+fmtR(avgR)+(avgV?" e voto esecuzione "+avgV+"/10":"")+". Possibile tilt — considera una pausa dopo 2 loss consecutive."});
  }
  if(maxStreak>=4) ins.push({type:"alert",cat:"📉 STREAK",col:"#D97706",text:"La tua max losing streak è "+maxStreak+" trade consecutivi. Pianifica una regola di stop: es. pausa dopo 3 loss di fila."});
  // ── MFE (R sul tavolo) ──
  const withMfe=filtered.filter(function(t){return t.mfe!=null;});
  if(withMfe.length>=3){
    const mfeRArr=withMfe.map(function(t){return parseFloat(t.mfe)||0;}).filter(function(v){return v!=null;});
    const avgMfe=mfeRArr.length>0?parseFloat((mfeRArr.reduce(function(a,b){return a+b;},0)/mfeRArr.length).toFixed(2)):null;
    const wasted=avgMfe!=null?parseFloat((avgMfe-Math.max(m.exp,0)).toFixed(2)):null;
    if(wasted!=null&&wasted>0.5) ins.push({type:"alert",cat:"📊 R SUL TAVOLO",col:"#DC2626",text:"MFE medio +"+avgMfe+"R, esci a "+fmtR(m.exp)+" → lasci "+wasted+"R per trade sul tavolo. Il tuo TP potrebbe essere troppo basso."});
    else if(wasted!=null&&wasted<0.2&&avgMfe!=null) ins.push({type:"positive",cat:"📊 GESTIONE TP",col:"#16A34A",text:"Stai sfruttando bene i tuoi trade: MFE medio +"+avgMfe+"R, exit "+fmtR(m.exp)+". Pochissimo R lasciato sul tavolo."});
  }
  // ── MAE (SL troppo stretto) ──
  // MAE rimosso — non disponibile
  // ── SESSIONI ──
  const sessions=["Asian","London","NY"];
  const sessData=sessions.map(function(s){const st=filtered.filter(function(t){return getSessioneWithTz(t.data_apertura)===s;});if(st.length<2)return null;const sm=calcMetrics(st);return {s,n:st.length,exp:sm.exp,wr:sm.wr};}).filter(Boolean);
  if(sessData.length>=2){
    const best=sessData.reduce(function(a,b){return b.exp>a.exp?b:a;});
    const worst=sessData.reduce(function(a,b){return b.exp<a.exp?b:a;});
    if(best.exp>0) ins.push({type:"positive",cat:"🌍 SESSIONE",col:"#16A34A",text:"La tua sessione migliore è "+best.s+": WR "+best.wr+"%, Exp "+fmtR(best.exp)+" su "+best.n+" trade."});
    if(worst.exp<-0.1) ins.push({type:"alert",cat:"🌍 SESSIONE",col:"#D97706",text:"La tua sessione peggiore è "+worst.s+": WR "+worst.wr+"%, Exp "+fmtR(worst.exp)+" su "+worst.n+" trade. Considera di ridurre l'operatività in questa sessione."});
  }
  // ── GIORNI ──
  const days=["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
  const dayData=days.map(function(d,i){const dt=filtered.filter(function(t){return t.data_apertura&&new Date(t.data_apertura).getDay()===i;});if(dt.length<2)return null;const dm=calcMetrics(dt);return {d,n:dt.length,exp:dm.exp,wr:dm.wr};}).filter(Boolean);
  if(dayData.length>=2){
    const best=dayData.reduce(function(a,b){return b.exp>a.exp?b:a;});
    const worst=dayData.reduce(function(a,b){return b.exp<a.exp?b:a;});
    if(best.exp>0.3) ins.push({type:"positive",cat:"📅 GIORNO",col:"#16A34A",text:"Il tuo giorno migliore è "+best.d+": WR "+best.wr+"%, Exp "+fmtR(best.exp)+" su "+best.n+" trade."});
    if(worst.exp<-0.2) ins.push({type:"alert",cat:"📅 GIORNO",col:"#D97706",text:"Il tuo giorno peggiore è "+worst.d+": WR "+worst.wr+"%, Exp "+fmtR(worst.exp)+". Considera una pausa il "+worst.d+"."});
  }
  // ── ESECUZIONE ──
  const highExec=filtered.filter(function(t){return t.sc_esecuzione>=8;});
  const lowExec=filtered.filter(function(t){return t.sc_esecuzione!=null&&t.sc_esecuzione<5;});
  if(highExec.length>=2&&lowExec.length>=2){
    const mH=calcMetrics(highExec); const mL=calcMetrics(lowExec);
    if(mH.exp-mL.exp>0.3) ins.push({type:"positive",cat:"📋 ESECUZIONE",col:"#16A34A",text:"Con voto esecuzione ≥8: Exp "+fmtR(mH.exp)+" | Con voto <5: Exp "+fmtR(mL.exp)+". Seguire il piano vale "+parseFloat((mH.exp-mL.exp).toFixed(2))+"R per trade."});
  }
  // ── CHECKLIST ──
  const withCk=filtered.filter(function(t){return t.checklist&&Object.keys(t.checklist).length>0;});
  if(withCk.length>=4){
    const ckOk=withCk.filter(function(t){const vals=Object.values(t.checklist);return vals.length>0&&vals.filter(Boolean).length/vals.length>=0.8;});
    const ckKo=withCk.filter(function(t){const vals=Object.values(t.checklist);return vals.length>0&&vals.filter(Boolean).length/vals.length<0.5;});
    if(ckOk.length>=2&&ckKo.length>=2){
      const mOk=calcMetrics(ckOk); const mKo=calcMetrics(ckKo);
      if(mOk.wr-mKo.wr>10) ins.push({type:"positive",cat:"✓ CHECKLIST",col:"#16A34A",text:"Checklist rispettata ≥80%: WR "+mOk.wr+"% | Checklist <50%: WR "+mKo.wr+"%. Rispettare il piano aumenta il win rate del "+(mOk.wr-mKo.wr)+"%."});
    }
  }
  // ── PROFIT FACTOR ──
  if(m.pf>=2) ins.push({type:"positive",cat:"💪 EDGE",col:"#16A34A",text:"Profit Factor "+m.pf+" — stai generando un edge statistico solido. Per ogni R perso ne guadagni "+m.pf+"."});
  if(m.pf<1&&filtered.length>=10) ins.push({type:"alert",cat:"⚠ EDGE",col:"#DC2626",text:"Profit Factor "+m.pf+" su "+filtered.length+" trade — la strategia non è profittevole. Analizza le cause prima di continuare."});
  return ins;
}

// ── COACH ─────────────────────────────────────────────────────────────────────
function Coach({c,trades,strategie,conti,btProjects,btTrades}){
  const [selConti,setSelConti]=useState([]);
  const [selStrat,setSelStrat]=useState([]);
  const [tab,setTab]=useState("insight");
  const [activeQ,setActiveQ]=useState(null);
  const [periodo,setPeriodo]=useState("tutto");

  function toggleC(id){setSelConti(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  function toggleS(id){setSelStrat(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}

  const now=new Date();
  function filterByPeriodo(list){
    if(periodo==="tutto") return list;
    const days=periodo==="1m"?30:periodo==="3m"?90:periodo==="6m"?180:365;
    const from=new Date(now.getTime()-days*86400000).toISOString();
    return list.filter(function(t){return t.data_apertura&&t.data_apertura>=from;});
  }

  const baseFiltered=trades.filter(function(t){
    if(selConti.length>0&&!selConti.includes(t.conto_id)) return false;
    if(selStrat.length>0&&!selStrat.includes(t.strategia_id)) return false;
    return true;
  });
  const filtered=filterByPeriodo(baseFiltered);
  const capMap=makeCapMap(conti);
  const m=calcMetrics(filtered);
  const insights=genInsights(filtered,strategie);
  const alerts=insights.filter(function(i){return i.type==="alert";});
  const positives=insights.filter(function(i){return i.type==="positive";});

  // ── BOT: calcola configurazione ottimale ──
  function calcBotOttimale(){
    const withMfe=filtered.filter(function(t){return t.mfe!=null;});
    if(withMfe.length<5) return null;
    const steps=[];
    for(let v=0.5;v<=6.01;v=Math.round((v+0.25)*100)/100) steps.push(v);
    let best=null;
    steps.forEach(function(tpR){
      [0,...steps.filter(function(s){return s<tpR;})].forEach(function(beR){
        let totalR=0,wins=0;
        withMfe.forEach(function(t){
          const mfeR=parseFloat(t.mfe)||0;
          const maeR=null;// MAE rimosso
          let r;
          if(maeR!==null&&maeR<=-1){r=beR>0&&mfeR>=beR?0:-1;}
          else if(mfeR>=tpR){r=tpR;}
          else{r=t.r_result;}
          totalR+=r; if(r>0)wins++;
        });
        if(!best||totalR>best.totalR) best={tpR,beR,totalR:parseFloat(totalR.toFixed(2)),wr:Math.round(wins/withMfe.length*100)};
      });
    });
    const realTotalR=withMfe.reduce(function(s,t){return s+t.r_result;},0);
    return best?{...best,realR:parseFloat(realTotalR.toFixed(2)),gain:parseFloat((best.totalR-realTotalR).toFixed(2)),n:withMfe.length}:null;
  }
  const botOttimale=calcBotOttimale();

  // ── Calcola risposta per domanda preimpostata ──
  function answerQuestion(qKey){
    const m=calcMetrics(filtered);
    if(filtered.length<3) return "Inserisci almeno 3 trade per ottenere risposte basate sui dati.";
    if(qKey==="best_day"){
      const days=["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
      const ds=days.map(function(d,i){const dt=filtered.filter(function(t){return t.data_apertura&&new Date(t.data_apertura).getDay()===i;});if(dt.length<2)return null;const dm=calcMetrics(dt);return {d,n:dt.length,exp:dm.exp,wr:dm.wr};}).filter(Boolean);
      if(ds.length===0) return "Non hai abbastanza trade per giorno da analizzare.";
      const best=ds.reduce(function(a,b){return b.exp>a.exp?b:a;});
      const worst=ds.reduce(function(a,b){return b.exp<a.exp?b:a;});
      return "GIORNO MIGLIORE: "+best.d+" - Expectancy "+fmtR(best.exp)+", WR "+best.wr+"%, su "+best.n+" trade.\n\nGIORNO PEGGIORE: "+worst.d+" - Expectancy "+fmtR(worst.exp)+", WR "+worst.wr+"%, su "+worst.n+" trade.\n\nConcentra la tua attivita il "+best.d+(worst.exp<0?" ed evita il "+worst.d:"")+".\n\nClassifica completa:\n"+ds.sort(function(a,b){return b.exp-a.exp;}).map(function(d,i){return (i+1)+". "+d.d+": "+fmtR(d.exp)+" exp, "+d.wr+"% WR ("+d.n+" trade)";}).join("\n");
    }
    if(qKey==="best_hour"){
      const hs=Array.from({length:24},function(_,h){const ht=filtered.filter(function(t){return t.data_apertura&&getHourWithTz(t.data_apertura)===h;});if(ht.length<2)return null;const hm=calcMetrics(ht);return {h,n:ht.length,exp:hm.exp,wr:hm.wr};}).filter(Boolean);
      if(hs.length===0) return "Non hai abbastanza dati orari.";
      const best=hs.reduce(function(a,b){return b.exp>a.exp?b:a;});
      const worst=hs.reduce(function(a,b){return b.exp<a.exp?b:a;});
      const bestSess=getSessioneWithTz(new Date(new Date().setHours(best.h,0,0,0)).toISOString());
      return "ORA MIGLIORE: "+best.h+":00 (sessione "+bestSess+") - Expectancy "+fmtR(best.exp)+", WR "+best.wr+"%, su "+best.n+" trade.\n\nORA PEGGIORE: "+worst.h+":00 - Expectancy "+fmtR(worst.exp)+", WR "+worst.wr+"%, su "+worst.n+" trade.\n\nTop 3 ore migliori:\n"+hs.sort(function(a,b){return b.exp-a.exp;}).slice(0,3).map(function(h,i){return (i+1)+". "+h.h+":00 - "+fmtR(h.exp)+" exp ("+h.n+" trade)";}).join("\n");
    }
    if(qKey==="best_strat"){
      const ss=strategie.map(function(s){const st=filtered.filter(function(t){return t.strategia_id===s.id;});if(st.length<2)return null;const sm=calcMetrics(st);return {nome:s.nome,n:st.length,exp:sm.exp,wr:sm.wr,pf:sm.pf,totalR:sm.totalR};}).filter(Boolean);
      if(ss.length===0) return "Non hai abbastanza trade per strategia da analizzare.";
      const best=ss.reduce(function(a,b){return b.exp>a.exp?b:a;});
      const worst=ss.reduce(function(a,b){return b.exp<a.exp?b:a;});
      return "STRATEGIA MIGLIORE: "+best.nome+"\nExpectancy "+fmtR(best.exp)+" | WR "+best.wr+"% | PF "+best.pf+" | "+best.n+" trade | Total "+fmtR(best.totalR)+"\n\n"+(ss.length>1?"STRATEGIA PEGGIORE: "+worst.nome+"\nExpectancy "+fmtR(worst.exp)+" | WR "+worst.wr+"% | PF "+worst.pf+" | "+worst.n+" trade\n\n":"")+"Classifica:\n"+ss.sort(function(a,b){return b.exp-a.exp;}).map(function(s,i){return (i+1)+". "+s.nome+": "+fmtR(s.exp)+" exp, "+s.wr+"% WR";}).join("\n");
    }
    if(qKey==="r_sul_tavolo"){
      const mfeArr=filtered.filter(function(t){return t.mfe!=null;}).map(function(t){const mfeR=parseFloat(t.mfe)||0;return {mfeR,r:t.r_result};}).filter(function(x){return x.mfeR>0;});
      if(mfeArr.length<3) return "Inserisci MFE su almeno 3 trade per questa analisi.\n\nMFE = il prezzo piu favorevole raggiunto durante il trade prima che tornasse indietro.";
      const avgMfe=parseFloat((mfeArr.reduce(function(s,v){return s+v.mfeR;},0)/mfeArr.length).toFixed(2));
      const avgExit=parseFloat((m.exp).toFixed(2));
      const wasted=parseFloat((avgMfe-Math.max(avgExit,0)).toFixed(2));
      const reached2R=mfeArr.filter(function(d){return d.mfeR>=2;});
      const wasted2R=reached2R.filter(function(d){return d.r<0;}).length;
      return "MFE MEDIO: +"+avgMfe+"R - il prezzo arriva mediamente qui prima di tornare.\nUSCITA MEDIA: "+fmtR(avgExit)+"\nR LASCIATO SUL TAVOLO: ~"+wasted+"R per trade\n\n"+(wasted>0.5?"Stai uscendo troppo presto. Il tuo TP ottimale e probabilmente piu alto di quello che usi ora.":"Stai sfruttando bene i trade favorevoli.")+"\n\n"+(reached2R.length>0?"Su "+reached2R.length+" trade che arrivano a +2R MFE, "+wasted2R+" finiscono in loss ("+Math.round(wasted2R/reached2R.length*100)+"%).":"");
    }
    if(qKey==="losing_streak"){
      const sorted=filtered.slice().sort(function(a,b){return new Date(a.data_apertura)-new Date(b.data_apertura);});
      let streak=0,maxStreak=0,maxStart=null;
      sorted.forEach(function(t){if(t.r_result<0){streak++;if(streak>maxStreak){maxStreak=streak;maxStart=t.data_apertura;}}else{streak=0;}});
      const afterLoss2=[];
      for(let i=2;i<sorted.length;i++){
        if(sorted[i-1].r_result<0&&sorted[i-2].r_result<0){
          afterLoss2.push({r:sorted[i].r_result,voto:sorted[i].sc_esecuzione});
        }
      }
      const avgRafterLoss2=afterLoss2.length>0?parseFloat((afterLoss2.reduce(function(s,t){return s+t.r;},0)/afterLoss2.length).toFixed(2)):null;
      const avgVotoAfterLoss2=afterLoss2.filter(function(t){return t.voto!=null;}).length>0?parseFloat((afterLoss2.filter(function(t){return t.voto!=null;}).reduce(function(s,t){return s+t.voto;},0)/afterLoss2.filter(function(t){return t.voto!=null;}).length).toFixed(1)):null;
      return "MAX LOSING STREAK: "+maxStreak+" trade consecutivi in loss"+(maxStart?" (dal "+fmtDate(maxStart)+")":"")+"\n\n"+(afterLoss2.length>0?"Dopo 2 loss consecutive hai fatto "+afterLoss2.length+" trade:\nR medio: "+fmtR(avgRafterLoss2)+(avgVotoAfterLoss2!=null?"\nVoto esecuzione medio: "+avgVotoAfterLoss2+"/10":"")+"\n\n"+(avgRafterLoss2<0?"Tendi a perdere anche dopo 2 loss - possibile tilt. Considera una pausa di 30 minuti dopo 2 loss.":"Tendi a reagire bene dopo le losing streak."):"Dati insufficienti per analisi post-streak.");
    }
    if(qKey==="best_session"){
      const sessions=["Asian","London","NY"];
      const sd=sessions.map(function(s){const st=filtered.filter(function(t){return getSessioneWithTz(t.data_apertura)===s;});if(st.length<2)return null;const sm=calcMetrics(st);return {s,n:st.length,exp:sm.exp,wr:sm.wr,pf:sm.pf};}).filter(Boolean);
      if(sd.length===0) return "Non hai abbastanza trade per sessione.";
      const best=sd.reduce(function(a,b){return b.exp>a.exp?b:a;});
      return "SESSIONE MIGLIORE: "+best.s+" - Exp "+fmtR(best.exp)+", WR "+best.wr+"%, PF "+best.pf+", "+best.n+" trade.\n\nDettaglio:\n"+sd.sort(function(a,b){return b.exp-a.exp;}).map(function(s){return s.s+": "+fmtR(s.exp)+" exp, "+s.wr+"% WR ("+s.n+" trade)";}).join("\n");
    }
    if(qKey==="long_short"){
      const longs=filtered.filter(function(t){return t.direzione==="L";});
      const shorts=filtered.filter(function(t){return t.direzione==="S";});
      const ml=calcMetrics(longs); const ms=calcMetrics(shorts);
      return "LONG ("+longs.length+" trade): Exp "+fmtR(ml.exp)+" | WR "+ml.wr+"% | PF "+ml.pf+" | Total "+fmtR(ml.totalR)+"\nSHORT ("+shorts.length+" trade): Exp "+fmtR(ms.exp)+" | WR "+ms.wr+"% | PF "+ms.pf+" | Total "+fmtR(ms.totalR)+"\n\n"+(ml.exp>ms.exp?"Rendi meglio in LONG. Valuta di ridurre i short o analizzarne i setup.":"Rendi meglio in SHORT. Interessante edge ribassista.")+"\n\n"+(Math.abs(ml.exp-ms.exp)>0.3?"Differenza significativa tra long e short - potrebbe valere un filtro direzionale.":"La differenza tra long e short e contenuta.");
    }
    if(qKey==="execution"){
      const highExec=filtered.filter(function(t){return t.sc_esecuzione>=8;});
      const midExec=filtered.filter(function(t){return t.sc_esecuzione>=5&&t.sc_esecuzione<8;});
      const lowExec=filtered.filter(function(t){return t.sc_esecuzione!=null&&t.sc_esecuzione<5;});
      if(highExec.length<2&&lowExec.length<2) return "Inserisci il voto di esecuzione su piu trade per questa analisi.";
      const mH=calcMetrics(highExec); const mM=calcMetrics(midExec); const mL=calcMetrics(lowExec);
      return "VOTO ESECUZIONE vs RISULTATI:\n\nVoto >=8 ("+highExec.length+" trade): Exp "+fmtR(mH.exp)+" | WR "+mH.wr+"%\nVoto 5-7 ("+midExec.length+" trade): Exp "+fmtR(mM.exp)+" | WR "+mM.wr+"%\nVoto <5 ("+lowExec.length+" trade): Exp "+fmtR(mL.exp)+" | WR "+mL.wr+"%\n\n"+(highExec.length>=2&&lowExec.length>=2&&mH.exp>mL.exp+0.2?"I trade con alta esecuzione performano meglio di "+parseFloat((mH.exp-mL.exp).toFixed(2))+"R per trade rispetto a quelli a bassa esecuzione. Seguire il piano paga.":highExec.length>=2&&lowExec.length>=2&&mH.exp<mL.exp?"I trade a bassa esecuzione performano meglio - potresti star sovra-pianificando.":"Continua a registrare il voto di esecuzione per analisi piu precise.");
    }
    return "Domanda non riconosciuta.";
  }

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <ModuleHeader title="Coach Statistico" subtitle={filtered.length+" trade · "+insights.length+" insight"} tooltip="Il Coach analizza i tuoi dati reali e genera insight statistici puri. Nessuna AI — tutto calcolato sui tuoi numeri." c={c}/>

      {/* FILTRI + PERIODO */}
      <div style={{padding:"8px 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:12,flexShrink:0,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{display:"flex",gap:5}}>{conti.map(function(cn){const s=selConti.includes(cn.id);return <button key={cn.id} onClick={function(){toggleC(cn.id);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+(s?c.ac:c.bd),background:s?c.ac+"15":"transparent",color:s?c.ac:c.txm,fontSize:11,fontWeight:s?700:400,cursor:"pointer",fontFamily:"inherit"}}>{cn.nome}</button>;})}</div>
        <div style={{width:1,background:c.bd,height:16}}/>
        <div style={{display:"flex",gap:5}}>{strategie.map(function(s){const sel=selStrat.includes(s.id);return <button key={s.id} onClick={function(){toggleS(s.id);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+(sel?c.ac:c.bd),background:sel?c.ac+"15":"transparent",color:sel?c.ac:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{s.nome}</button>;})}</div>
        <div style={{width:1,background:c.bd,height:16}}/>
        <select value={periodo} onChange={function(e){setPeriodo(e.target.value);}} style={{padding:"4px 10px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
          {[["tutto","Tutti i trade"],["1m","Ultimo mese"],["3m","Ultimi 3 mesi"],["6m","Ultimi 6 mesi"],["1y","Ultimo anno"]].map(function(o){return <option key={o[0]} value={o[0]}>{o[1]}</option>;})}
        </select>
      </div>

      {/* TABS */}
      <div style={{padding:"0 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",flexShrink:0}}>
        {[["insight","💡 Insight"],["domande","❓ Domande"],["report","📊 Report"]].map(function(t){const active=tab===t[0];return(
          <button key={t[0]} onClick={function(){setTab(t[0]);}} style={{padding:"9px 16px",border:"none",borderBottom:active?"2px solid "+c.ac:"2px solid transparent",background:"transparent",color:active?c.ac:c.txm,fontSize:11,fontWeight:active?700:400,cursor:"pointer",fontFamily:"inherit"}}>{t[1]}</button>
        );})}
      </div>

      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        <DisclaimerCampione n={filtered.length} c={c}/>

        {/* ── BOT BANNER (sempre visibile in tutti i tab) ── */}
        {botOttimale&&(
          <div style={{marginBottom:16,borderRadius:14,overflow:"hidden",border:"1px solid #4F46E530"}}>
            <div style={{background:"linear-gradient(135deg,#4F46E5,#7C3AED)",padding:"14px 18px",display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:18}}>🤖</span>
              <div>
                <div style={{fontSize:12,fontWeight:800,color:"#fff",marginBottom:2}}>BOT — Configurazione Ottimale</div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.7)"}}>Calcolato su {botOttimale.n} trade con MFE · Zero AI, puro calcolo</div>
              </div>
            </div>
            <div style={{background:c.card,padding:"14px 18px"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:12}}>
                {[
                  {l:"TP Ottimale",v:botOttimale.tpR+"R",col:"#4F46E5",tt:"Il livello di Take Profit (espresso in multipli di R) che avrebbe massimizzato il P/L totale sui tuoi trade storici, basandosi sul MFE di ogni operazione. Non è garantito che funzioni in futuro, ma è il punto di uscita storicamente più efficiente."},
                  {l:"BE Ottimale",v:botOttimale.beR>0?botOttimale.beR+"R":"Nessuno",col:"#0F766E",tt:"Il punto ottimale (in R) in cui spostare lo Stop Loss a Breakeven — cioè al prezzo di entrata, azzerando il rischio. Spostarlo troppo presto causa molti BE inutili su trade che sarebbero stati vincenti. Questo valore è quello che storicamente avrebbe minimizzato le perdite massimizzando i profitti."},
                  {l:"Win Rate Sim.",v:botOttimale.wr+"%",col:botOttimale.wr>=50?"#16A34A":"#DC2626",tt:"Il win rate che avresti ottenuto applicando la configurazione ottimale (TP+BE calcolati dal Bot) ai tuoi trade storici. Può differire dal win rate reale perché cambiare il TP cambia quanti trade raggiungono l'obiettivo."},
                ].map(function(kpi,i){return(
                  <div key={i} style={{background:c.bg,borderRadius:9,padding:"10px 12px",textAlign:"center"}}>
                    <div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:3,display:"flex",alignItems:"center",justifyContent:"center",gap:2}}>{kpi.l}{kpi.tt&&<Tooltip c={c} text={kpi.tt} pos="bottom"/>}</div>
                    <div style={{fontSize:16,fontWeight:800,color:kpi.col}}>{kpi.v}</div>
                  </div>
                );})}
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center",padding:"10px 14px",borderRadius:10,background:botOttimale.gain>0?"#16A34A10":"#DC262610",border:"1px solid "+(botOttimale.gain>0?"#16A34A30":"#DC262630")}}>
                <div style={{flex:1}}>
                  <span style={{fontSize:11,color:c.tx}}>Con questa gestione avresti fatto </span>
                  <strong style={{fontSize:13,color:botOttimale.gain>0?"#16A34A":"#DC2626"}}>{fmtR(botOttimale.totalR)}</strong>
                  <span style={{fontSize:11,color:c.tx}}> invece di </span>
                  <strong style={{fontSize:13,color:c.tx}}>{fmtR(botOttimale.realR)}</strong>
                  {botOttimale.gain>0&&<span style={{fontSize:11,color:"#16A34A"}}> → <strong>+{botOttimale.gain}R recuperati</strong></span>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB: INSIGHT ── */}
        {tab==="insight"&&(
          filtered.length<5?(
            <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Inserisci almeno 5 trade per generare insight.</div>
          ):(
            <>
              {insights.length===0&&<div style={{textAlign:"center",padding:"40px",color:c.txm,fontSize:13}}>Nessun pattern significativo rilevato. Inserisci più trade con dati completi.</div>}
              {alerts.length>0&&(
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:11,fontWeight:700,color:c.rd,marginBottom:8,letterSpacing:"0.06em"}}>⚠ DA CORREGGERE</div>
                  <div style={{display:"flex",flexDirection:"column",gap:7}}>
                    {alerts.map(function(ins,i){return(
                      <div key={i} style={{padding:"12px 15px",borderRadius:11,background:ins.col+"0D",border:"1px solid "+ins.col+"30",display:"flex",gap:10,alignItems:"flex-start"}}>
                        <span style={{fontSize:11,fontWeight:700,color:ins.col,flexShrink:0,minWidth:100}}>{ins.cat}</span>
                        <span style={{fontSize:11,color:c.tx,lineHeight:1.65}}>{ins.text}</span>
                      </div>
                    );})}
                  </div>
                </div>
              )}
              {positives.length>0&&(
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:c.gr,marginBottom:8,letterSpacing:"0.06em"}}>✓ PUNTI DI FORZA</div>
                  <div style={{display:"flex",flexDirection:"column",gap:7}}>
                    {positives.map(function(ins,i){return(
                      <div key={i} style={{padding:"12px 15px",borderRadius:11,background:ins.col+"0D",border:"1px solid "+ins.col+"30",display:"flex",gap:10,alignItems:"flex-start"}}>
                        <span style={{fontSize:11,fontWeight:700,color:ins.col,flexShrink:0,minWidth:100}}>{ins.cat}</span>
                        <span style={{fontSize:11,color:c.tx,lineHeight:1.65}}>{ins.text}</span>
                      </div>
                    );})}
                  </div>
                </div>
              )}
            </>
          )
        )}

        {/* ── TAB: DOMANDE ── */}
        {tab==="domande"&&(function(){
          const QUESTIONS=[
            {key:"best_day",icon:"📅",label:"Qual è il mio giorno migliore?",desc:"Analisi expectancy e WR per ogni giorno della settimana"},
            {key:"best_hour",icon:"🕐",label:"Qual è la mia ora migliore?",desc:"Performance per fascia oraria — trova quando sei più profittevole"},
            {key:"best_session",icon:"🌍",label:"Quale sessione funziona meglio?",desc:"Asian vs London vs NY — dove guadagni davvero"},
            {key:"best_strat",icon:"◈",label:"Quale strategia dovrei usare di più?",desc:"Ranking strategie per expectancy, WR e profit factor"},
            {key:"long_short",icon:"⇅",label:"Rendo meglio long o short?",desc:"Confronto completo direzione — edge direzionale"},
            {key:"r_sul_tavolo",icon:"📊",label:"Dove sto lasciando R sul tavolo?",desc:"Analisi MFE — quanto profitto potenziale perdi ogni trade"},
            {key:"losing_streak",icon:"⚡",label:"Cosa succede dopo una losing streak?",desc:"Pattern tilt — il tuo comportamento dopo le perdite"},
            {key:"execution",icon:"📋",label:"Il voto esecuzione impatta i risultati?",desc:"Correlazione tra disciplina e performance"},
          ];
          return(
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {filtered.length<3&&<div style={{background:c.am+"10",borderRadius:9,padding:"10px 14px",border:"1px solid "+c.am+"30",fontSize:11,color:c.am}}>⚠ Inserisci almeno 3 trade.</div>}
              {!activeQ&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {QUESTIONS.map(function(q){return(
                    <button key={q.key} onClick={function(){setActiveQ(q.key);}} disabled={filtered.length<3}
                      style={{textAlign:"left",padding:"13px 14px",borderRadius:10,border:"1px solid "+c.bd,background:c.card,color:c.tx,cursor:filtered.length<3?"not-allowed":"pointer",fontFamily:"inherit",opacity:filtered.length<3?0.5:1}}
                      onMouseEnter={function(e){if(filtered.length>=3)e.currentTarget.style.borderColor=c.ac+"60";}}
                      onMouseLeave={function(e){e.currentTarget.style.borderColor=c.bd;}}>
                      <div style={{fontSize:18,marginBottom:6}}>{q.icon}</div>
                      <div style={{fontSize:12,fontWeight:700,marginBottom:3}}>{q.label}</div>
                      <div style={{fontSize:10,color:c.txm,lineHeight:1.5}}>{q.desc}</div>
                    </button>
                  );})}
                </div>
              )}
              {activeQ&&(
                <div>
                  <button onClick={function(){setActiveQ(null);}} style={{padding:"5px 12px",borderRadius:7,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit",marginBottom:12}}>← Torna alle domande</button>
                  <div style={{background:c.card,borderRadius:12,padding:"16px 18px",border:"1px solid "+c.bd}}>
                    <div style={{fontSize:12,fontWeight:700,marginBottom:12,color:c.ac}}>{QUESTIONS.find(function(q){return q.key===activeQ;})?.label}</div>
                    <pre style={{fontSize:12,color:c.tx,lineHeight:1.8,whiteSpace:"pre-wrap",fontFamily:"inherit",margin:0}}>{answerQuestion(activeQ)}</pre>
                  </div>
                  <div style={{textAlign:"center",fontSize:9,color:c.txm,marginTop:8}}>Zero AI · calcolo puro sui tuoi dati reali</div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── TAB: REPORT ── */}
        {tab==="report"&&(function(){
          if(filtered.length<3) return <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Inserisci almeno 3 trade per generare il report.</div>;
          const totalPnl=filtered.reduce(function(s,t){return s+(t.pnl_eur||0);},0);
          const stratReport=strategie.map(function(s){const st=filtered.filter(function(t){return t.strategia_id===s.id;});if(st.length<2)return null;const sm=calcMetrics(st);return {nome:s.nome,n:st.length,exp:sm.exp,wr:sm.wr,pf:sm.pf,totalR:sm.totalR};}).filter(Boolean).sort(function(a,b){return b.exp-a.exp;});
          const sessStats=["Asian","London","NY"].map(function(s){const st=filtered.filter(function(t){return getSessioneWithTz(t.data_apertura)===s;});if(st.length<2)return null;const sm=calcMetrics(st);return {s,n:st.length,exp:sm.exp,wr:sm.wr};}).filter(Boolean);
          const dayData=["Dom","Lun","Mar","Mer","Gio","Ven","Sab"].map(function(d,i){const dt=filtered.filter(function(t){return t.data_apertura&&new Date(t.data_apertura).getDay()===i;});if(dt.length<2)return null;const dm=calcMetrics(dt);return {d,n:dt.length,exp:dm.exp,wr:dm.wr};}).filter(Boolean);
          const bestDay=dayData.length>0?dayData.reduce(function(a,b){return b.exp>a.exp?b:a;}):null;
          const worstDay=dayData.length>0?dayData.reduce(function(a,b){return b.exp<a.exp?b:a;}):null;
          const withMfe=filtered.filter(function(t){return t.mfe!=null;});
          const mfeRArr=withMfe.map(function(t){return parseFloat(t.mfe)||0;}).filter(Boolean);
          const avgMfe=mfeRArr.length>0?parseFloat((mfeRArr.reduce(function(a,b){return a+b;},0)/mfeRArr.length).toFixed(2)):null;
          const ins=genInsights(filtered,strategie);
          return(
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div style={{background:"linear-gradient(135deg,#4F46E5,#7C3AED)",borderRadius:12,padding:"16px 20px",color:"#fff"}}>
                <div style={{fontSize:14,fontWeight:800,marginBottom:2}}>Report EdgeLab</div>
                <div style={{fontSize:10,opacity:0.8}}>{filtered.length} trade analizzati · {new Date().toLocaleDateString("it-IT")}</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                {[{l:"P/L Totale",v:fmtR(m.totalR),col:m.totalR>=0?c.gr:c.rd},{l:"Win Rate",v:m.wr+"%",col:m.wr>=50?c.gr:c.rd},{l:"Profit Factor",v:m.pf,col:parseFloat(m.pf)>=1.5?c.gr:parseFloat(m.pf)>=1?c.am:c.rd},{l:"Expectancy",v:fmtR(m.exp),col:m.exp>=0?c.gr:c.rd},{l:"Max DD",v:"-"+m.maxDD+"R",col:c.rd},{l:"Avg Win",v:fmtR(m.avgWin),col:c.gr},{l:"Avg Loss",v:fmtR(m.avgLoss),col:c.rd},{l:"Trade Tot.",v:m.total,col:c.tx}].map(function(kpi,i){return(
                  <div key={i} style={{background:c.card,borderRadius:9,padding:"10px 12px",border:"1px solid "+c.bd,textAlign:"center"}}>
                    <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:3}}>{kpi.l}</div>
                    <div style={{fontSize:13,fontWeight:700,color:kpi.col}}>{kpi.v}</div>
                  </div>
                );})}
              </div>
              {stratReport.length>0&&(
                <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd}}>
                  <div style={{fontSize:11,fontWeight:700,marginBottom:10}}>◈ Strategie</div>
                  {stratReport.map(function(s,i){return(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:i<stratReport.length-1?"1px solid "+c.bdl:"none"}}>
                      <div><div style={{fontSize:11,fontWeight:600}}>{s.nome}</div><div style={{fontSize:9,color:c.txm}}>{s.n} trade · WR {s.wr}% · PF {s.pf}</div></div>
                      <div style={{textAlign:"right"}}><div style={{fontSize:13,fontWeight:700,color:s.exp>=0?c.gr:c.rd}}>{fmtR(s.exp)}</div><div style={{fontSize:9,color:s.totalR>=0?c.gr:c.rd}}>Total {fmtR(s.totalR)}</div></div>
                    </div>
                  );})}
                </div>
              )}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {bestDay&&<div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd}}><div style={{fontSize:10,fontWeight:700,color:c.txm,marginBottom:8}}>📅 GIORNI</div><div style={{fontSize:11,marginBottom:4}}>✅ {bestDay.d}: {fmtR(bestDay.exp)} ({bestDay.wr}% WR)</div>{worstDay&&worstDay.exp<0&&<div style={{fontSize:11}}>⚠ {worstDay.d}: {fmtR(worstDay.exp)} ({worstDay.wr}% WR)</div>}</div>}
                {sessStats.length>0&&<div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd}}><div style={{fontSize:10,fontWeight:700,color:c.txm,marginBottom:8}}>🌍 SESSIONI</div>{sessStats.sort(function(a,b){return b.exp-a.exp;}).map(function(s,i){return <div key={i} style={{fontSize:11,marginBottom:3}}>{s.exp>=0?"✅":"⚠"} {s.s}: {fmtR(s.exp)} ({s.wr}% WR)</div>;})}</div>}
              </div>
              {avgMfe&&<div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd}}><div style={{fontSize:10,fontWeight:700,color:c.txm,marginBottom:6}}>📊 MAE / MFE</div><div style={{fontSize:11,lineHeight:1.7}}>MFE medio: <strong style={{color:c.gr}}>+{avgMfe}R</strong> · Uscita media: <strong style={{color:m.exp>=0?c.gr:c.rd}}>{fmtR(m.exp)}</strong>{parseFloat(avgMfe)-Math.max(m.exp,0)>0.3&&<div style={{marginTop:4,color:c.am}}>⚠ Lasci mediamente {(parseFloat(avgMfe)-Math.max(m.exp,0)).toFixed(2)}R per trade sul tavolo.</div>}</div></div>}
              {ins.length>0&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  {ins.filter(function(i){return i.type==="alert";}).slice(0,3).length>0&&<div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.rd+"30"}}><div style={{fontSize:10,fontWeight:700,color:c.rd,marginBottom:8}}>⚠ DA CORREGGERE</div>{ins.filter(function(i){return i.type==="alert";}).slice(0,3).map(function(a,i){return <div key={i} style={{fontSize:10,color:c.tx,lineHeight:1.6,marginBottom:6,paddingLeft:8,borderLeft:"2px solid "+c.rd}}>{a.text}</div>;})}</div>}
                  {ins.filter(function(i){return i.type==="positive";}).slice(0,3).length>0&&<div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.gr+"30"}}><div style={{fontSize:10,fontWeight:700,color:c.gr,marginBottom:8}}>✓ PUNTI DI FORZA</div>{ins.filter(function(i){return i.type==="positive";}).slice(0,3).map(function(a,i){return <div key={i} style={{fontSize:10,color:c.tx,lineHeight:1.6,marginBottom:6,paddingLeft:8,borderLeft:"2px solid "+c.gr}}>{a.text}</div>;})}</div>}
                </div>
              )}
              <div style={{textAlign:"center",fontSize:9,color:c.txm,padding:"8px 0"}}>EdgeLab · {new Date().toLocaleDateString("it-IT")} · Zero AI, calcolo puro sui dati reali</div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── SIMULATORE GESTIONE POSIZIONE ────────────────────────────────────────────
function SimGestione({c,trades,strategie,conti}){
  const [selConti,setSelConti]=useState([]);
  const [selStrat,setSelStrat]=useState([]);
  const [tp,setTp]=useState(2.0);
  const [be,setBe]=useState(0);
  const [parz1Pct,setParz1Pct]=useState(0);
  const [parz1R,setParz1R]=useState(1.0);
  const [parz2Pct,setParz2Pct]=useState(0);
  const [parz2R,setParz2R]=useState(1.5);
  const [useParz1,setUseParz1]=useState(false);
  const [useParz2,setUseParz2]=useState(false);
  const [simDone,setSimDone]=useState(false);

  function toggleC(id){setSelConti(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  function toggleS(id){setSelStrat(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}

  const filtered=trades.filter(function(t){
    if(selConti.length>0&&!selConti.includes(t.conto_id)) return false;
    if(selStrat.length>0&&!selStrat.includes(t.strategia_id)) return false;
    return true;
  });
  const capMap=makeCapMap(conti);
  const withMfe=filtered.filter(function(t){return t.mfe!=null;});
  const pctMfe=filtered.length>0?Math.round(withMfe.length/filtered.length*100):0;

  // Simula un singolo trade con la nuova gestione
  function simSingleTrade(t){
    if(t.mfe==null) return {r:t.r_result,simulated:false};
    const mfeR=parseFloat(t.mfe)||0;
    const maeR=null;// MAE rimosso
    // SL toccato?
    if(maeR!==null&&maeR<=-1){
      if(be>0&&mfeR>=be) return {r:0,simulated:true,note:"BE preso"};
      return {r:-1,simulated:true,note:"SL pieno"};
    }
    // Parziali
    let remaining=1.0; let totalR=0;
    if(useParz1&&mfeR>=parz1R&&parz1Pct>0){
      const pct=parz1Pct/100;
      totalR+=pct*parz1R;
      remaining-=pct;
    }
    if(useParz2&&mfeR>=parz2R&&parz2Pct>0){
      const pct=Math.min(parz2Pct/100,remaining);
      totalR+=pct*parz2R;
      remaining-=pct;
    }
    // TP sul rimanente
    if(mfeR>=tp){
      totalR+=remaining*tp;
      return {r:parseFloat(totalR.toFixed(2)),simulated:true,note:"TP "+tp+"R"+(useParz1&&mfeR>=parz1R?" + Parz1":"")};
    }
    // Non arriva al TP — esce al risultato reale (proporzione sul rimanente)
    totalR+=remaining*t.r_result;
    return {r:parseFloat(totalR.toFixed(2)),simulated:true,note:"TP mancato, exit reale"};
  }

  const simResults=withMfe.map(function(t){
    const sim=simSingleTrade(t);
    return {...t,sim_r:sim.r,sim_note:sim.note,r_diff:parseFloat((sim.r-t.r_result).toFixed(2))};
  });

  const realTotalR=parseFloat(simResults.reduce(function(s,t){return s+t.r_result;},0).toFixed(2));
  const simTotalR=parseFloat(simResults.reduce(function(s,t){return s+t.sim_r;},0).toFixed(2));
  const gained=parseFloat((simTotalR-realTotalR).toFixed(2));
  const simWins=simResults.filter(function(t){return t.sim_r>0;}).length;
  const simWR=simResults.length>0?Math.round(simWins/simResults.length*100):0;
  const realWR=simResults.length>0?Math.round(simResults.filter(function(t){return t.r_result>0;}).length/simResults.length*100):0;

  // Equity curves
  const realCurve=[{i:0,r:0}];let eq=0;
  simResults.forEach(function(t,i){eq+=t.r_result;realCurve.push({i:i+1,r:parseFloat(eq.toFixed(2))});});
  const simCurve=[{i:0,r:0}];let seq=0;
  simResults.forEach(function(t,i){seq+=t.sim_r;simCurve.push({i:i+1,r:parseFloat(seq.toFixed(2))});});

  const steps=[];for(let v=0.5;v<=6.01;v=Math.round((v+0.25)*100)/100)steps.push(v);

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <ModuleHeader title="Simulatore Gestione" subtitle={filtered.length+" trade totali · "+withMfe.length+" con MFE"} tooltip="Ri-simula ogni trade con una gestione posizione alternativa (TP, BE, Parziali) usando i dati MAE/MFE reali. Confronta il risultato simulato con quello reale per vedere quanti R avresti recuperato." c={c}/>
      <div style={{padding:"8px 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:12,flexShrink:0,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{display:"flex",gap:5}}>{conti.map(function(cn){const s=selConti.includes(cn.id);return <button key={cn.id} onClick={function(){toggleC(cn.id);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+(s?c.ac:c.bd),background:s?c.ac+"15":"transparent",color:s?c.ac:c.txm,fontSize:11,fontWeight:s?700:400,cursor:"pointer",fontFamily:"inherit"}}>{cn.nome}</button>;})}</div>
        <div style={{width:1,background:c.bd,height:16}}/>
        <div style={{display:"flex",gap:5}}>{strategie.map(function(s){const sel=selStrat.includes(s.id);return <button key={s.id} onClick={function(){toggleS(s.id);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+(sel?c.ac:c.bd),background:sel?c.ac+"15":"transparent",color:sel?c.ac:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{s.nome}</button>;})}</div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        {pctMfe<30&&filtered.length>0&&(
          <div style={{padding:"10px 14px",borderRadius:9,background:c.am+"10",border:"1px solid "+c.am+"30",fontSize:11,color:c.am,marginBottom:12}}>
            ⚠ Solo il {pctMfe}% dei trade ha MFE compilato. La simulazione usa solo questi {withMfe.length} trade. Aggiungi MFE agli altri dal Journal per risultati più accurati.
          </div>
        )}
        {withMfe.length<3?(
          <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Inserisci MFE su almeno 3 trade per usare il Simulatore Gestione.</div>
        ):(
          <>
            {/* PARAMETRI */}
            <div style={{background:c.card,borderRadius:12,padding:"16px 18px",border:"1px solid "+c.bd,marginBottom:14}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:14}}>⚙ Parametri Gestione</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:14}}>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:c.txm,marginBottom:6}}>TAKE PROFIT</div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <input type="range" min={0.5} max={6} step={0.25} value={tp} onChange={function(e){setTp(parseFloat(e.target.value));}} style={{flex:1,accentColor:c.ac}}/>
                    <span style={{fontSize:14,fontWeight:800,color:c.ac,minWidth:40}}>{tp}R</span>
                  </div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:c.txm,marginBottom:6}}>BREAKEVEN (0 = nessuno)</div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <input type="range" min={0} max={Math.max(tp-0.25,0)} step={0.25} value={be} onChange={function(e){setBe(parseFloat(e.target.value));}} style={{flex:1,accentColor:c.am}}/>
                    <span style={{fontSize:14,fontWeight:800,color:c.am,minWidth:60}}>{be===0?"No BE":be+"R"}</span>
                  </div>
                </div>
              </div>
              {/* PARZIALI */}
              <div style={{borderTop:"1px solid "+c.bdl,paddingTop:12}}>
                <div style={{fontSize:11,fontWeight:700,marginBottom:10}}>Parziali</div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {[[useParz1,setUseParz1,parz1Pct,setParz1Pct,parz1R,setParz1R,"Parziale 1"],[useParz2,setUseParz2,parz2Pct,setParz2Pct,parz2R,setParz2R,"Parziale 2"]].map(function(row,ri){
                    const [use,setUse,pct,setPct,rVal,setRVal,label]=row;
                    return(
                      <div key={ri} style={{padding:"10px 12px",borderRadius:9,border:"1px solid "+(use?c.ac+"40":c.bd),background:use?c.ac+"05":"transparent"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:use?10:0}}>
                          <input type="checkbox" checked={use} onChange={function(e){setUse(e.target.checked);}} style={{accentColor:c.ac,width:14,height:14,cursor:"pointer"}}/>
                          <span style={{fontSize:11,fontWeight:600,color:use?c.tx:c.txm}}>{label}</span>
                        </div>
                        {use&&(
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                            <div>
                              <div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:4}}>CHIUDI % POSIZIONE</div>
                              <div style={{display:"flex",alignItems:"center",gap:8}}>
                                <input type="range" min={10} max={90} step={5} value={pct} onChange={function(e){setPct(parseInt(e.target.value));}} style={{flex:1,accentColor:c.ac}}/>
                                <span style={{fontSize:13,fontWeight:700,color:c.ac,minWidth:36}}>{pct}%</span>
                              </div>
                            </div>
                            <div>
                              <div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:4}}>A QUALE R</div>
                              <div style={{display:"flex",alignItems:"center",gap:8}}>
                                <input type="range" min={0.5} max={tp} step={0.25} value={rVal} onChange={function(e){setRVal(parseFloat(e.target.value));}} style={{flex:1,accentColor:"#0F766E"}}/>
                                <span style={{fontSize:13,fontWeight:700,color:"#0F766E",minWidth:40}}>{rVal}R</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* RISULTATI AGGREGATI */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              {[{l:"REALE",tr:realTotalR,wr:realWR,col:c.txm,border:c.bd},{l:"SIMULATO",tr:simTotalR,wr:simWR,col:"#0F766E",border:"#0F766E40"}].map(function(block){return(
                <div key={block.l} style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+block.border}}>
                  <div style={{fontSize:9,fontWeight:700,color:block.col,letterSpacing:"0.08em",marginBottom:10}}>{block.l}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <div style={{background:c.bg,borderRadius:8,padding:"8px 10px"}}><div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:2}}>P/L TOTALE</div><div style={{fontSize:15,fontWeight:800,color:block.tr>=0?c.gr:c.rd}}>{fmtR(block.tr)}</div></div>
                    <div style={{background:c.bg,borderRadius:8,padding:"8px 10px"}}><div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:2}}>WIN RATE</div><div style={{fontSize:15,fontWeight:800,color:block.wr>=50?c.gr:c.rd}}>{block.wr}%</div></div>
                  </div>
                </div>
              );})}
            </div>

            {/* BANNER DIFFERENZA */}
            <div style={{padding:"14px 18px",borderRadius:12,background:gained>0?"#16A34A10":"#DC262610",border:"1px solid "+(gained>0?"#16A34A30":"#DC262630"),marginBottom:14,display:"flex",alignItems:"center",gap:12}}>
              <div style={{fontSize:24}}>{gained>0?"📈":"📉"}</div>
              <div>
                <div style={{fontSize:13,fontWeight:800,color:gained>=0?c.gr:c.rd}}>{gained>=0?"+":""}{gained}R {gained>0?"recuperati":"persi"} rispetto alla gestione reale</div>
                <div style={{fontSize:10,color:c.txm,marginTop:2}}>Su {withMfe.length} trade · TP {tp}R · BE {be>0?be+"R":"nessuno"}{useParz1?" · Parz1 "+parz1Pct+"% a "+parz1R+"R":""}{useParz2?" · Parz2 "+parz2Pct+"% a "+parz2R+"R":""}</div>
              </div>
            </div>

            {/* EQUITY CURVE */}
            <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,marginBottom:10,display:"flex",justifyContent:"space-between"}}>
                <span>Equity Curve Comparativa</span>
                <div style={{display:"flex",gap:12,fontSize:10,color:c.txm}}>
                  <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:16,height:2,background:"#0F766E",display:"inline-block",borderRadius:2}}/> Simulato</span>
                  <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:16,height:2,background:c.txm,display:"inline-block",borderRadius:2,opacity:0.5}}/> Reale</span>
                </div>
              </div>
              {(function(){
                const W=500,H=130,PL=38,PB=18;
                const allV=[...realCurve.map(function(p){return p.r;}),...simCurve.map(function(p){return p.r;})];
                const minV=Math.min.apply(null,allV); const maxV=Math.max.apply(null,allV);
                const range=maxV-minV||1;
                const cH=H-PB; const cW=W-PL;
                const toX=function(i,len){return PL+(i/Math.max(len-1,1))*cW;};
                const toY=function(v){return cH-8-((v-minV)/range)*(cH-16);};
                const rPts=realCurve.map(function(p,i){return toX(i,realCurve.length)+","+toY(p.r);}).join(" ");
                const sPts=simCurve.map(function(p,i){return toX(i,simCurve.length)+","+toY(p.r);}).join(" ");
                return(
                  <svg width="100%" viewBox={"0 0 "+W+" "+H} style={{overflow:"visible"}}>
                    <text x={PL-3} y={toY(maxV)+3} textAnchor="end" fontSize="8" fill={c.txm}>{maxV>0?"+":""}{maxV}R</text>
                    <text x={PL-3} y={toY(minV)+3} textAnchor="end" fontSize="8" fill={c.txm}>{minV>0?"+":""}{minV}R</text>
                    {minV<0&&maxV>0&&<line x1={PL} y1={toY(0)} x2={W} y2={toY(0)} stroke={c.bd} strokeWidth="1" strokeDasharray="3,3"/>}
                    <polyline points={rPts} fill="none" stroke={c.txm} strokeWidth="1.5" strokeDasharray="4,3" strokeLinejoin="round" opacity="0.5"/>
                    <polyline points={sPts} fill="none" stroke="#0F766E" strokeWidth="2.5" strokeLinejoin="round"/>
                    <circle cx={toX(simCurve.length-1,simCurve.length)} cy={toY(simCurve[simCurve.length-1].r)} r="4" fill="#0F766E"/>
                  </svg>
                );
              })()}
            </div>

            {/* TABELLA TRADE PER TRADE */}
            <div style={{background:c.card,borderRadius:12,border:"1px solid "+c.bd,overflow:"hidden"}}>
              <div style={{padding:"12px 16px",borderBottom:"1px solid "+c.bd,fontSize:11,fontWeight:700}}>Trade per Trade — Dettaglio Simulazione</div>
              <div style={{display:"grid",gridTemplateColumns:"80px 50px 60px 60px 60px 60px auto",gap:0,padding:"7px 16px",background:c.bg,borderBottom:"1px solid "+c.bd}}>
                {["Data","Asset","MFE","Reale","Simul.","Delta","Note"].map(function(h,i){return <div key={i} style={{fontSize:8,color:c.txs,fontWeight:700,letterSpacing:"0.05em"}}>{h}</div>;})}
              </div>
              {simResults.slice().sort(function(a,b){return new Date(b.data_apertura)-new Date(a.data_apertura);}).slice(0,50).map(function(t,i,arr){
                const mfeR=t.mfe!=null?parseFloat(t.mfe):null;
                return(
                  <div key={t.id} style={{display:"grid",gridTemplateColumns:"80px 50px 60px 60px 60px 60px auto",gap:0,padding:"8px 16px",borderBottom:i<arr.length-1?"1px solid "+c.bdl:"none",alignItems:"center"}}>
                    <div style={{fontSize:10,color:c.txm}}>{fmtDate(t.data_apertura)}</div>
                    <div style={{fontSize:10,fontWeight:600}}>{t.asset}</div>
                    <div style={{fontSize:10,color:c.gr}}>{mfeR!=null?"+"+mfeR+"R":"—"}</div>
                    <div><Badge v={t.r_result} c={c}/></div>
                    <div style={{fontSize:11,fontWeight:700,color:t.sim_r>0?c.gr:t.sim_r<0?c.rd:c.am}}>{t.sim_r>0?"+":""}{t.sim_r}R</div>
                    <div style={{fontSize:10,fontWeight:600,color:t.r_diff>0?"#16A34A":t.r_diff<0?c.rd:c.txm}}>{t.r_diff>0?"+":""}{t.r_diff}R</div>
                    <div style={{fontSize:9,color:c.txm}}>{t.sim_note||"—"}</div>
                  </div>
                );
              })}
              {simResults.length>50&&<div style={{padding:"8px 16px",fontSize:10,color:c.txm,textAlign:"center"}}>Mostrati 50 trade su {simResults.length}</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── REPORT ────────────────────────────────────────────────────────────────────
function Report({c,trades,strategie,conti}){
  const [selConti,setSelConti]=useState([]);
  const [selStrat,setSelStrat]=useState([]);
  const [dateFrom,setDateFrom]=useState("");
  const [dateTo,setDateTo]=useState("");
  const [printing,setPrinting]=useState(false);
  function toggleC(id){setSelConti(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  function toggleS(id){setSelStrat(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}

  const filtered=trades.filter(function(t){
    if(selConti.length>0&&!selConti.includes(t.conto_id)) return false;
    if(selStrat.length>0&&!selStrat.includes(t.strategia_id)) return false;
    if(dateFrom&&t.data_apertura&&t.data_apertura<dateFrom) return false;
    if(dateTo&&t.data_apertura&&t.data_apertura>dateTo+"T23:59:59") return false;
    return true;
  }).sort(function(a,b){return new Date(a.data_apertura)-new Date(b.data_apertura);});

  const m=calcMetrics(filtered);
  const capMap=makeCapMap(conti);
  const curve=buildEquityCurve(filtered,capMap);
  const totalEur=filtered.reduce(function(s,t){return s+(t.pnl_eur||0);},0);
  const stratPerf=strategie.map(function(s){const st=filtered.filter(function(t){return t.strategia_id===s.id;});return {...s,...calcMetrics(st)};}).filter(function(s){return s.total>0;});
  const moods=["😌 Calmo","😐 Neutro","😰 Ansioso","😤 Frustrato","😵 Euforico","😴 Stanco"];
  const moodStats=moods.map(function(mood){const mt=filtered.filter(function(t){return t.mood===mood;});const mm=calcMetrics(mt);return {mood,n:mt.length,wr:mm.wr,exp:mm.exp};}).filter(function(x){return x.n>0;});
  const days=["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
  const dayStats=days.map(function(d,i){const dt=filtered.filter(function(t){return t.data_apertura&&new Date(t.data_apertura).getDay()===i;});if(dt.length===0) return null;const dm=calcMetrics(dt);return {d,n:dt.length,wr:dm.wr,exp:dm.exp};}).filter(Boolean);

  function printReport(){window.print();}

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"11px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:c.sb,flexShrink:0}}>
        <div><div style={{fontSize:15,fontWeight:700,letterSpacing:"-0.02em"}}>Report</div><div style={{fontSize:10,color:c.txm}}>{filtered.length} trade nel periodo</div></div>
        <button onClick={printReport} style={{padding:"7px 16px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>🖨 Stampa / PDF</button>
      </div>
      {/* FILTRI */}
      <div style={{padding:"10px 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:14,flexShrink:0,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>CONTI</div><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{conti.map(function(cn){const s=selConti.includes(cn.id);return <button key={cn.id} onClick={function(){toggleC(cn.id);}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(s?c.ac:c.bd),background:s?c.ac+"15":"transparent",color:s?c.ac:c.txm,fontSize:11,fontWeight:s?700:400,cursor:"pointer",fontFamily:"inherit"}}>{cn.nome}</button>;})}</div></div>
        <div style={{width:1,background:c.bd,alignSelf:"stretch"}}/>
        <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>STRATEGIE</div><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{strategie.map(function(s){const sel=selStrat.includes(s.id);return <button key={s.id} onClick={function(){toggleS(s.id);}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(sel?c.ac:c.bd),background:sel?c.ac+"15":"transparent",color:sel?c.ac:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{s.nome}</button>;})}</div></div>
        <div style={{width:1,background:c.bd,alignSelf:"stretch"}}/>
        <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
          <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>DAL</div><input type="date" value={dateFrom} onChange={function(e){setDateFrom(e.target.value);}} style={{padding:"5px 8px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none"}}/></div>
          <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>AL</div><input type="date" value={dateTo} onChange={function(e){setDateTo(e.target.value);}} style={{padding:"5px 8px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none"}}/></div>
          {(dateFrom||dateTo)&&<button onClick={function(){setDateFrom("");setDateTo("");}} style={{padding:"5px 10px",borderRadius:7,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>✕ Reset</button>}
        </div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        {filtered.length===0?(
          <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Nessun trade nel periodo selezionato.</div>
        ):(
          <div id="report-content">
            {/* HEADER REPORT */}
            <div style={{background:"linear-gradient(135deg,#4F46E5,#7C3AED)",borderRadius:12,padding:"16px 20px",marginBottom:14,color:"#fff"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                  <EdgeLabLogo size={24}/>
                  <div style={{fontSize:16,fontWeight:800,letterSpacing:"-0.03em"}}>EdgeLab — Report Trading</div>
                </div>
              <div style={{fontSize:11,opacity:0.85}}>
                {dateFrom||dateTo?((dateFrom?fmtDate(dateFrom):"inizio")+" → "+(dateTo?fmtDate(dateTo):"oggi")):"Tutti i trade"}
                {selConti.length>0?" · "+conti.filter(function(cn){return selConti.includes(cn.id);}).map(function(cn){return cn.nome;}).join(", "):""}
                {selStrat.length>0?" · "+strategie.filter(function(s){return selStrat.includes(s.id);}).map(function(s){return s.nome;}).join(", "):""}
              </div>
            </div>
            {/* METRICHE CHIAVE */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:12}}>
              {[{l:"Trade Totali",v:m.total,col:c.tx,tt:"Numero totale di trade nel periodo del report."},{l:"Win Rate",v:m.wr+"%",col:m.wr>=50?c.gr:c.rd,tt:"Percentuale di trade chiusi in profitto."},{l:"Profit Factor",v:m.pf,col:m.pf>=1.5?c.gr:m.pf>=1?c.am:c.rd,tt:"Guadagno totale diviso perdita totale. Sopra 1.5 è buono."},{l:"Expectancy",v:fmtR(m.exp),col:m.exp>=0?c.gr:c.rd,tt:"Guadagno medio atteso per ogni trade."},{l:"Max Drawdown",v:"-"+m.maxDD+"R",col:c.rd,tt:"La perdita massima dal picco al minimo nel periodo."},{l:"P/L $",v:totalEur!==0?"$"+totalEur.toFixed(0):"—",col:totalEur>=0?c.gr:c.rd,tt:"Il risultato monetario totale nel periodo del report."}].map(function(mm,i){return(
                <div key={i} style={{background:c.card,borderRadius:10,padding:"10px 12px",border:"1px solid "+c.bd,textAlign:"center"}}><div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:3,display:"flex",alignItems:"center",justifyContent:"center",gap:2}}>{mm.l}{mm.tt&&<Tooltip c={c} text={mm.tt} pos="bottom"/>}</div><div style={{fontSize:14,fontWeight:700,color:mm.col}}>{mm.v}</div></div>
              );})}
            </div>
            {/* EQUITY CURVE */}
            <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Equity Curve</div>
              <EqChartSVG curve={curve} c={c} h={110} unit="R"/>
            </div>
            {/* STRATEGIE */}
            {stratPerf.length>0&&(
              <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:700,marginBottom:10,display:"flex",alignItems:"center",gap:4}}>Performance per Strategia<Tooltip c={c} text="Confronto delle metriche chiave tra le tue strategie nel periodo analizzato. Ti permette di vedere quale strategia sta effettivamente portando risultati e quale invece pesa sul tuo P/L complessivo. Una strategia con molti trade ma bassa expectancy potrebbe valere la pena di essere messa in pausa, mentre dovresti aumentare la frequenza su quella con il profit factor più alto."/></div>
                <div style={{display:"grid",gridTemplateColumns:"repeat("+Math.min(stratPerf.length,3)+",1fr)",gap:8}}>
                  {stratPerf.map(function(s){return(
                    <div key={s.id} style={{background:c.bg,borderRadius:8,padding:"10px 12px"}}>
                      <div style={{fontSize:11,fontWeight:700,marginBottom:6}}>{s.nome}</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
                        {[{l:"Trade",v:s.total},{l:"Win Rate",v:s.wr+"%"},{l:"PF",v:s.pf},{l:"P/L",v:fmtR(s.totalR)}].map(function(mm,i){return(
                          <div key={i}><div style={{fontSize:8,color:c.txm,fontWeight:600}}>{mm.l}</div><div style={{fontSize:11,fontWeight:700,color:i===3?(s.totalR>=0?c.gr:c.rd):c.tx}}>{mm.v}</div></div>
                        );})}
                      </div>
                    </div>
                  );})}
                </div>
              </div>
            )}
            {/* COMPORTAMENTALE */}
            {moodStats.length>0&&(
              <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:700,marginBottom:10,display:"flex",alignItems:"center",gap:4}}>Stato Mentale vs Risultati<Tooltip c={c} text="Confronta le tue performance in base a come ti sentivi prima di entrare in trade. Se quando sei ansioso o frustrato i risultati peggiorano sensibilmente, è un segnale chiaro che il tuo stato emotivo influenza le tue decisioni. Usa questa sezione per capire in quale condizione mentale sei più lucido e disciplinato, e considera di saltare il trading nei giorni negativi."/></div>
                {moodStats.map(function(x,i){return(
                  <div key={i} style={{marginBottom:i<moodStats.length-1?8:0}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:11,fontWeight:600}}>{x.mood}</span><div style={{display:"flex",gap:10}}><span style={{fontSize:11,fontWeight:700,color:x.wr>=50?c.gr:c.rd}}>WR {x.wr}%</span><span style={{fontSize:11,fontWeight:700,color:x.exp>=0?c.gr:c.rd}}>{fmtR(x.exp)}</span><span style={{fontSize:10,color:c.txm}}>{x.n} trade</span></div></div>
                    <div style={{height:4,borderRadius:3,background:c.bd}}><div style={{height:"100%",width:x.wr+"%",background:x.wr>=60?c.gr:x.wr>=40?c.am:c.rd,borderRadius:3}}/></div>
                  </div>
                );})}
              </div>
            )}
            {/* PATTERN TEMPORALI */}
            {dayStats.length>0&&(
              <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd}}>
                <div style={{fontSize:12,fontWeight:700,marginBottom:10,display:"flex",alignItems:"center",gap:4}}>Performance per Giorno<Tooltip c={c} text="Analisi delle tue performance divise per giorno della settimana nel periodo del report. Se un giorno appare sistematicamente negativo mese dopo mese, è un segnale che qualcosa in quel giorno — la liquidità del mercato, le notizie economiche ricorrenti, o il tuo stato mentale — penalizza i tuoi risultati. Considera di ridurre o eliminare il trading in quel giorno specifico."/></div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {dayStats.map(function(d){return(
                    <div key={d.d} style={{background:c.bg,borderRadius:8,padding:"8px 12px",textAlign:"center",minWidth:60}}>
                      <div style={{fontSize:11,fontWeight:700,marginBottom:3}}>{d.d}</div>
                      <div style={{fontSize:11,fontWeight:700,color:d.wr>=50?c.gr:c.rd}}>{d.wr}%</div>
                      <div style={{fontSize:9,color:d.exp>=0?c.gr:c.rd}}>{fmtR(d.exp)}</div>
                      <div style={{fontSize:9,color:c.txm}}>{d.n} trade</div>
                    </div>
                  );})}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── TOOLTIP & DISCLAIMER ──────────────────────────────────────────────────────
function Tooltip({text,c,pos}){
  const [show,setShow]=useState(false);
  const ref=useRef(null);
  useEffect(function(){
    if(!show) return;
    function fn(e){if(ref.current&&!ref.current.contains(e.target))setShow(false);}
    document.addEventListener("mousedown",fn);
    return function(){document.removeEventListener("mousedown",fn);};
  },[show]);
  const placement=pos||"right";
  const popStyle=placement==="right"
    ?{left:"calc(100% + 8px)",top:"50%",transform:"translateY(-50%)"}
    :placement==="left"
    ?{right:"calc(100% + 8px)",top:"50%",transform:"translateY(-50%)"}
    :placement==="top"
    ?{bottom:"calc(100% + 8px)",left:"50%",transform:"translateX(-50%)"}
    :{top:"calc(100% + 8px)",left:"50%",transform:"translateX(-50%)"};
  return(
    <span ref={ref} style={{position:"relative",display:"inline-flex",alignItems:"center",marginLeft:5}}>
      <button
        onClick={function(e){e.stopPropagation();setShow(function(s){return !s;});}}
        style={{width:15,height:15,borderRadius:"50%",border:"1px solid "+c.ac+"50",background:c.ac+"12",color:c.ac,fontSize:8,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",justifyContent:"center",fontWeight:800,flexShrink:0,padding:0,lineHeight:1}}
      >?</button>
      {show&&(
        <div style={{position:"absolute",...popStyle,background:c.card,border:"1px solid "+c.bd,borderRadius:10,padding:"11px 14px",width:270,zIndex:9999,boxShadow:"0 8px 28px rgba(0,0,0,0.22)",fontSize:11,color:c.tx,lineHeight:1.7,fontWeight:400}}>
          <div style={{fontSize:9,fontWeight:700,color:c.ac,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.06em"}}>ℹ INFO</div>
          {text}
        </div>
      )}
    </span>
  );
}

function ModuleHeader({title,subtitle,tooltip,c,right}){
  return(
    <div style={{padding:"11px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:c.sb,flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",gap:0}}>
        <div>
          <div style={{fontSize:15,fontWeight:700,letterSpacing:"-0.02em",display:"flex",alignItems:"center",gap:4}}>
            {title}
            {tooltip&&<Tooltip text={tooltip} c={c}/>}
          </div>
          {subtitle&&<div style={{fontSize:10,color:c.txm}}>{subtitle}</div>}
        </div>
      </div>
      {right&&<div style={{display:"flex",gap:6,alignItems:"center"}}>{right}</div>}
    </div>
  );
}


// ── KPIBOX — KPI con tooltip integrato ────────────────────────────────────────
function KpiBox({label,value,sub,col,tooltip,c,size,accent}){
  return(
    <div style={{background:c.card,borderRadius:11,padding:size==="lg"?"16px 18px":"11px 14px",border:"1px solid "+c.bd,display:"flex",flexDirection:"column",gap:3}}>
      <div style={{fontSize:9,fontWeight:700,color:c.txm,letterSpacing:"0.06em",textTransform:"uppercase",display:"flex",alignItems:"center",gap:2}}>
        {label}
        {tooltip&&<Tooltip text={tooltip} c={c} pos="bottom"/>}
      </div>
      <div style={{fontSize:size==="lg"?22:18,fontWeight:800,color:col||c.tx,letterSpacing:"-0.02em",lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontSize:9,color:c.txm,marginTop:1}}>{sub}</div>}
    </div>
  );
}

function DisclaimerCampione({n,c}){
  const min=300;
  if(n>=min) return null;
  const pct=Math.round((n/min)*100);
  return(
    <div style={{margin:"0 0 10px 0",padding:"8px 13px",borderRadius:9,background:c.am+"10",border:"1px solid "+c.am+"35",display:"flex",alignItems:"flex-start",gap:9}}>
      <span style={{fontSize:13,flexShrink:0,marginTop:1}}>⚠️</span>
      <div style={{fontSize:10,color:c.am,lineHeight:1.65}}>
        <strong>Validità statistica limitata:</strong> hai {n} trade su {min} minimi consigliati ({pct}%). Con meno di 300 campioni i pattern potrebbero non essere rappresentativi. Continua ad inserire trade per aumentare l'affidabilità delle analisi.
      </div>
    </div>
  );
}

// ── BACKTEST ──────────────────────────────────────────────────────────────────
function Backtest({c,trades,reload}){
  const {showConfirm,showAlert,ModalRenderer}=useModal();
  const [view,setView]=useState("lista"); // lista | progetto
  const [progetti,setProgetti]=useState([]);
  const [btTrades,setBtTrades]=useState([]);
  const [selProgetto,setSelProgetto]=useState(null);
  const [showNuovoProg,setShowNuovoProg]=useState(false);
  const [showNuovoTrade,setShowNuovoTrade]=useState(false);
  const [showImport,setShowImport]=useState(false);
  const [anTab,setAnTab]=useState("overview");

  // form nuovo progetto
  const [pForm,setPForm]=useState({nome:"",asset:"",timeframe:"",note:""});
  // parametri del progetto corrente (3 famiglie)
  const [editParams,setEditParams]=useState(false);
  const [newParam,setNewParam]=useState({famiglia:"direzionalita",nome:""});

  // form nuovo trade backtest — ricorda ultima data inserita
  const [lastBtDate,setLastBtDate]=useState("");
  function btTodayStr(){const n=new Date();const pad=function(x){return String(x).padStart(2,"0");};return n.getFullYear()+"-"+pad(n.getMonth()+1)+"-"+pad(n.getDate())+"T"+pad(n.getHours())+":"+pad(n.getMinutes());}
  const initTForm=function(d){return {data:d||(lastBtDate||btTodayStr()),data_chiusura:"",direzione:"L",entry:"",sl:"",exit:"",mae:"",mfe:"",params:[],note:"",confidence:0};};
  const [tForm,setTForm]=useState(initTForm(""));
  // stato per editing trade backtest
  const [editingTrade,setEditingTrade]=useState(null); // id del trade in modifica
  // stati simulatore ottimizzazione (devono stare a livello componente, non in IIFE)
  const [simTpR,setSimTpR]=useState(2);
  const [simBeR,setSimBeR]=useState(0);
  const [simParz1Pct,setSimParz1Pct]=useState(0);
  const [simParz1R,setSimParz1R]=useState(0);

  // carica dati da IndexedDB
  async function loadBt(){
    const [p,t]=await Promise.all([db.bt_progetti.toArray(),db.bt_trade.toArray()]);
    setProgetti(p);setBtTrades(t);
  }
  useEffect(function(){loadBt();},[]);

  const progettoCorrente=progetti.find(function(p){return p.id===selProgetto;})||null;
  const tradesCorrente=btTrades.filter(function(t){return t.progetto_id===selProgetto;});

  // ── salva progetto ──
  async function salvaProgetto(){
    if(!pForm.nome.trim()){showAlert("Nome mancante","Inserisci un nome per il progetto.","warning");return;}
    const prog={
      nome:pForm.nome.trim(),
      asset:pForm.asset||"",
      timeframe:pForm.timeframe||"",
      note:pForm.note||"",
      created_at:new Date().toISOString(),
      parametri:{direzionalita:[],trigger:[],confluenze_pro:[],confluenze_contro:[],extra:[]},
    };
    const id=await db.bt_progetti.add(prog);
    await loadBt();
    setSelProgetto(id);
    setView("progetto");
    setShowNuovoProg(false);
    setPForm({nome:"",asset:"",timeframe:"",note:""});
  }

  // ── aggiungi parametro ──
  async function addParametro(){
    if(!newParam.nome.trim()||!progettoCorrente) return;
    const updated={...progettoCorrente};
    updated.parametri={...updated.parametri};
    updated.parametri[newParam.famiglia]=[...(updated.parametri[newParam.famiglia]||[]),newParam.nome.trim()];
    await db.bt_progetti.update(progettoCorrente.id,{parametri:updated.parametri});
    await loadBt();
    setNewParam({famiglia:"direzionalita",nome:""});
  }

  async function removeParametro(famiglia,idx){
    if(!progettoCorrente) return;
    const updated={...progettoCorrente};
    updated.parametri={...updated.parametri};
    updated.parametri[famiglia]=updated.parametri[famiglia].filter(function(_,i){return i!==idx;});
    await db.bt_progetti.update(progettoCorrente.id,{parametri:updated.parametri});
    await loadBt();
  }

  // ── calcola R trade bt (ora inserito direttamente) ──
  function calcBtR(t){
    return parseFloat(t.r_result)||0;
  }

  // ── salva trade backtest ──
  async function salvaTrade(){
    if(tForm.r_result===""||tForm.r_result===null||tForm.r_result===undefined){showAlert("Campi mancanti","Il Risultato in R è obbligatorio.","warning");return;}
    if(!tForm.data_chiusura){showAlert("Campo mancante","L'orario di chiusura è obbligatorio per calcolare l'indice di affidabilità del Bot.","warning");return;}
    const r=parseFloat(tForm.r_result)||0;
    const td={
      progetto_id:selProgetto,
      data_apertura:tForm.data||new Date().toISOString(),
      data_chiusura:tForm.data_chiusura||null,
      direzione:tForm.direzione,
      mfe:tForm.mfe?parseFloat(tForm.mfe):null,
      params:tForm.params||[],
      note:tForm.note||"",
      confidence:tForm.confidence||0,
      r_result:r,
    };
    if(editingTrade){
      await db.bt_trade.update(editingTrade,td);
      setEditingTrade(null);
    } else {
      await db.bt_trade.add(td);
    }
    await loadBt();
    if(reload) reload();
    setShowNuovoTrade(false);
    setLastBtDate(tForm.data||"");
    setTForm(initTForm(tForm.data||""));
  }

  // ── importa trade live ──
  async function importaLive(){
    const liveTrades=trades.filter(function(t){return !t.draft&&t.r_result!=null;});
    let importati=0;
    for(const t of liveTrades){
      const exists=await db.bt_trade.where("progetto_id").equals(selProgetto).filter(function(bt){return bt._live_id===t.id;}).first();
      if(!exists){
        await db.bt_trade.add({
          progetto_id:selProgetto,
          _live_id:t.id,
          data_apertura:t.data_apertura,
          data_chiusura:t.data_chiusura||null,
          direzione:t.direzione,
          mfe:t.mfe||null,
          params:[],note:"[importato da live]",
          r_result:t.r_result||0,
          confidence:0,
        });
        importati++;
      }
    }
    await loadBt();
    setShowImport(false);
    showAlert("Import completato ✅","Importati "+importati+" trade live.\nPuoi ora assegnare i parametri a ciascuno dal tab Trade.","success");
  }

  function eliminaTrade(id){showConfirm("Elimina Trade","Sei sicuro di voler eliminare questo trade? L'operazione non può essere annullata.",async function(){await db.bt_trade.delete(id);await loadBt();},true);}
  function editaTrade(trade){
    setTForm({
      data:trade.data_apertura?trade.data_apertura.slice(0,16):"",
      data_chiusura:trade.data_chiusura?trade.data_chiusura.slice(0,16):"",
      direzione:trade.direzione||"L",
      r_result:trade.r_result!=null?trade.r_result:"",
      mfe:trade.mfe||"",
      params:trade.params||[],
      note:trade.note||"",
      confidence:trade.confidence||0,
    });
    setEditingTrade(trade.id);
    setShowNuovoTrade(true);
  }
  function eliminaProgetto(id){
    const p=progetti.find(function(x){return x.id===id;});
    const nT=btTrades.filter(function(t){return t.progetto_id===id;}).length;
    setDelBtAlsoTrade(true);
    setConfirmDelProg({id,nome:p?.nome||"",nTrade:nT});
  }
  async function doEliminaProgetto(){
    if(!confirmDelProg) return;
    if(delBtAlsoTrade) await db.bt_trade.where("progetto_id").equals(confirmDelProg.id).delete();
    await db.bt_progetti.delete(confirmDelProg.id);
    await loadBt();
    setConfirmDelProg(null);
    if(selProgetto===confirmDelProg.id){setSelProgetto(null);setView("lista");}
  }
  const [editProgettoId,setEditProgettoId]=useState(null);
  const [editPForm,setEditPForm]=useState({nome:"",asset:"",timeframe:"",note:""});
  const [confirmDelProg,setConfirmDelProg]=useState(null); // {id, nome, nTrade}
  const [delBtAlsoTrade,setDelBtAlsoTrade]=useState(true); // default: elimina anche trade
  function apriEditProgetto(e,p){
    e.stopPropagation();
    setEditPForm({nome:p.nome||"",asset:p.asset||"",timeframe:p.timeframe||"",note:p.note||""});
    setEditProgettoId(p.id);
  }
  async function salvaEditProgetto(){
    if(!editPForm.nome.trim()){showAlert("Nome mancante","Inserisci un nome per il progetto.","warning");return;}
    await db.bt_progetti.update(editProgettoId,{nome:editPForm.nome.trim(),asset:editPForm.asset||"",timeframe:editPForm.timeframe||"",note:editPForm.note||""});
    await loadBt();
    setEditProgettoId(null);
  }

  // ── ANALYTICS BACKTEST ──
  const allParams=progettoCorrente?[
    ...(progettoCorrente.parametri.direzionalita||[]).map(function(p){return {nome:p,famiglia:"direzionalita"};}),
    ...(progettoCorrente.parametri.trigger||[]).map(function(p){return {nome:p,famiglia:"trigger"};}),
    ...(progettoCorrente.parametri.confluenze_pro||[]).map(function(p){return {nome:p,famiglia:"confluenze_pro"};}),
    ...(progettoCorrente.parametri.confluenze_contro||[]).map(function(p){return {nome:p,famiglia:"confluenze_contro"};}),
    ...(progettoCorrente.parametri.extra||[]).map(function(p){return {nome:p,famiglia:"extra"};}),
  ]:[];

  const famColors={"direzionalita":"#4F46E5","trigger":"#0F766E","confluenze_pro":"#16A34A","confluenze_contro":"#DC2626","extra":"#D97706"};
  const famLabels={"direzionalita":"Direzionalità","trigger":"Trigger","confluenze_pro":"✅ Confluenze A Favore","confluenze_contro":"❌ Confluenze A Sfavore","extra":"Extra"};

  function metricsPerParam(paramNome){
    const ts=tradesCorrente.filter(function(t){return (t.params||[]).includes(paramNome);});
    return {n:ts.length,...calcMetrics(ts)};
  }

  // top combinazioni: 2-param e 3-param
  function topCombinazioni(maxK=2){
    if(allParams.length<2||tradesCorrente.length<3) return [];
    const combos=[];
    // genera tutte le coppie
    for(let i=0;i<allParams.length;i++){
      for(let j=i+1;j<allParams.length;j++){
        const names=[allParams[i].nome,allParams[j].nome];
        const ts=tradesCorrente.filter(function(t){return names.every(function(n){return (t.params||[]).includes(n);});});
        if(ts.length>=2){const m=calcMetrics(ts);combos.push({nomi:names,n:ts.length,...m});}
      }
    }
    if(maxK>=3){
      for(let i=0;i<allParams.length;i++){
        for(let j=i+1;j<allParams.length;j++){
          for(let k=j+1;k<allParams.length;k++){
            const names=[allParams[i].nome,allParams[j].nome,allParams[k].nome];
            const ts=tradesCorrente.filter(function(t){return names.every(function(n){return (t.params||[]).includes(n);});});
            if(ts.length>=2){const m=calcMetrics(ts);combos.push({nomi:names,n:ts.length,...m});}
          }
        }
      }
    }
    return combos.sort(function(a,b){return b.exp-a.exp;}).slice(0,8);
  }

  const paramStats=allParams.map(function(p){return {nome:p.nome,famiglia:p.famiglia,...metricsPerParam(p.nome)};}).filter(function(p){return p.n>0;}).sort(function(a,b){return b.exp-a.exp;});
  const topCombo=topCombinazioni(3);
  const metGlobali=calcMetrics(tradesCorrente);
  const eqCurve=buildEquityCurve(tradesCorrente.slice().sort(function(a,b){return new Date(a.data_apertura)-new Date(b.data_apertura);}),{});

  // ── VISTA LISTA PROGETTI ──
  if(view==="lista"){
    return(
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <ModuleHeader
          title="Backtest"
          subtitle={progetti.length+" progetti"}
          tooltip="Il Backtest ti permette di rispondere a 'e se?': cosa sarebbe successo se avessi usato parametri diversi — uno SL più largo, un filtro diverso per il bias, un trigger alternativo? Il sistema ricalcola i risultati su tutti i tuoi trade reali per ogni combinazione di parametri che specifichi, e confronta le metriche fianco a fianco per trovare la configurazione ottimale. Crea un progetto, definisci le famiglie di parametri da testare (Direzionalità, Trigger, Filtri Extra), inserisci i trade e ottieni analytics complete su ogni variante. Attenzione: ottimizzare troppo sui dati passati (overfitting) può dare risultati illusori — usa campioni ampi e valida su periodi diversi."
          c={c}
          right={<button onClick={function(){setShowNuovoProg(true);}} style={{padding:"7px 16px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>+ Nuovo Progetto</button>}
        />
        <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
          {progetti.length===0?(
            <div style={{textAlign:"center",padding:"60px",color:c.txm}}>
              <div style={{fontSize:32,marginBottom:12}}>◧</div>
              <div style={{fontSize:14,fontWeight:700,marginBottom:6}}>Nessun progetto Backtest</div>
              <div style={{fontSize:12,color:c.txm,marginBottom:20}}>Crea un progetto per testare setup e trigger su dati storici o live.</div>
              <button onClick={function(){setShowNuovoProg(true);}} style={{padding:"8px 20px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>+ Nuovo Progetto</button>
            </div>
          ):(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
              {progetti.map(function(p){
                const pts=btTrades.filter(function(t){return t.progetto_id===p.id;});
                const m=calcMetrics(pts);
                const nParams=(p.parametri.direzionalita||[]).length+(p.parametri.trigger||[]).length+(p.parametri.confluenze_pro||[]).length+(p.parametri.confluenze_contro||[]).length+(p.parametri.extra||[]).length;
                return(
                  <div key={p.id} style={{background:c.card,borderRadius:12,border:"1px solid "+c.bd,padding:"16px",cursor:"pointer",transition:"all 0.15s"}}
                    onClick={function(){setSelProgetto(p.id);setView("progetto");}}
                    onMouseEnter={function(e){e.currentTarget.style.borderColor=c.ac+"60";e.currentTarget.style.boxShadow="0 4px 12px rgba(79,70,229,0.12)";}}
                    onMouseLeave={function(e){e.currentTarget.style.borderColor=c.bd;e.currentTarget.style.boxShadow="none";}}
                  >
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:700}}>{p.nome}</div>
                        <div style={{fontSize:10,color:c.txm,marginTop:2}}>{p.asset||"—"}{p.timeframe?" · "+p.timeframe:""}</div>
                      </div>
                      <div style={{display:"flex",gap:4}}>
                        <button onClick={function(e){apriEditProgetto(e,p);}} title="Modifica progetto"
                          style={{color:c.ac,background:"none",border:"none",cursor:"pointer",fontSize:12,opacity:0.7,padding:2}}
                          onMouseEnter={function(e){e.currentTarget.style.opacity=1;}} onMouseLeave={function(e){e.currentTarget.style.opacity=0.7;}}>✏</button>
                        <button onClick={function(e){e.stopPropagation();eliminaProgetto(p.id);}} title="Elimina progetto"
                          style={{color:c.rd,background:"none",border:"none",cursor:"pointer",fontSize:12,opacity:0.6,padding:2}}
                          onMouseEnter={function(e){e.currentTarget.style.opacity=1;}} onMouseLeave={function(e){e.currentTarget.style.opacity=0.6;}}>✕</button>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:10}}>
                      {[{l:"Trade",v:pts.length},{l:"WR",v:m.wr+"%"},{l:"Expectancy",v:fmtR(m.exp)}].map(function(s,i){return(
                        <div key={i} style={{background:c.bg,borderRadius:7,padding:"7px 9px",textAlign:"center"}}>
                          <div style={{fontSize:8,color:c.txm,fontWeight:600}}>{s.l}</div>
                          <div style={{fontSize:13,fontWeight:700,color:c.tx}}>{s.v}</div>
                        </div>
                      );})}
                    </div>
                    <div style={{fontSize:9,color:c.txm}}>{nParams} parametri definiti · {p.created_at?fmtDate(p.created_at):""}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* MODALE MODIFICA PROGETTO */}
        {editProgettoId&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{background:c.card,borderRadius:14,padding:24,width:420,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
              <div style={{fontSize:15,fontWeight:700,marginBottom:16}}>✏ Modifica Progetto</div>
              {[{l:"Nome progetto *",k:"nome",ph:"es. NAS100 Backtest 2024"},{l:"Asset principale",k:"asset",ph:"es. NAS100"},{l:"Timeframe",k:"timeframe",ph:"es. M15, H1"},{l:"Note",k:"note",ph:"Descrizione opzionale"}].map(function(f){return(
                <div key={f.k} style={{marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:600,marginBottom:4}}>{f.l}</div>
                  <input value={editPForm[f.k]} onChange={function(e){setEditPForm(function(p){return {...p,[f.k]:e.target.value};});}} placeholder={f.ph} style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                </div>
              );})}
              <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16}}>
                <button onClick={function(){setEditProgettoId(null);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
                <button onClick={salvaEditProgetto} style={{padding:"8px 20px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Salva Modifiche</button>
              </div>
            </div>
          </div>
        )}
        <ModalRenderer c={c}/>
        {/* MODALE ELIMINA PROGETTO */}
        {confirmDelProg&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:700,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{background:c.card,borderRadius:14,padding:"24px",width:400,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
              <div style={{fontSize:15,fontWeight:700,marginBottom:6}}>🗑 Elimina Progetto</div>
              <div style={{fontSize:12,color:c.txm,marginBottom:14}}>Stai per eliminare <strong style={{color:c.tx}}>{confirmDelProg.nome}</strong>. Questa azione non può essere annullata.</div>
              {confirmDelProg.nTrade>0&&(
                <div onClick={function(){setDelBtAlsoTrade(function(v){return !v;});}}
                  style={{display:"flex",alignItems:"flex-start",gap:10,padding:"12px 14px",borderRadius:10,
                    background:delBtAlsoTrade?c.rd+"10":"transparent",border:"1px solid "+(delBtAlsoTrade?c.rd+"50":c.bd),
                    cursor:"pointer",marginBottom:18,transition:"all 0.15s"}}>
                  <div style={{width:18,height:18,borderRadius:4,border:"2px solid "+(delBtAlsoTrade?c.rd:c.bd),background:delBtAlsoTrade?c.rd:"transparent",
                    display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>
                    {delBtAlsoTrade&&<span style={{color:"#fff",fontSize:11,fontWeight:700}}>✓</span>}
                  </div>
                  <div>
                    <div style={{fontSize:12,fontWeight:600,color:delBtAlsoTrade?c.rd:c.tx}}>Elimina anche i {confirmDelProg.nTrade} trade del progetto</div>
                    <div style={{fontSize:10,color:c.txm,marginTop:2}}>Se deselezionato, il progetto viene rimosso ma i trade restano nel database.</div>
                  </div>
                </div>
              )}
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button onClick={function(){setConfirmDelProg(null);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
                <button onClick={doEliminaProgetto} style={{padding:"8px 18px",borderRadius:8,background:c.rd,border:"none",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                  {delBtAlsoTrade&&confirmDelProg.nTrade>0?"Elimina Progetto + Trade":"Elimina Progetto"}
                </button>
              </div>
            </div>
          </div>
        )}
        {/* MODALE NUOVO PROGETTO */}
        {showNuovoProg&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{background:c.card,borderRadius:14,padding:24,width:420,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
              <div style={{fontSize:15,fontWeight:700,marginBottom:16}}>Nuovo Progetto Backtest</div>
              {[{l:"Nome progetto *",k:"nome",ph:"es. NAS100 Backtest 2024"},{l:"Asset principale",k:"asset",ph:"es. NAS100"},{l:"Timeframe",k:"timeframe",ph:"es. M15, H1"},{l:"Note",k:"note",ph:"Descrizione opzionale"}].map(function(f){return(
                <div key={f.k} style={{marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:600,marginBottom:4}}>{f.l}</div>
                  <input value={pForm[f.k]} onChange={function(e){setPForm(function(p){return {...p,[f.k]:e.target.value};});}} placeholder={f.ph} style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                </div>
              );})}
              <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16}}>
                <button onClick={function(){setShowNuovoProg(false);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
                <button onClick={salvaProgetto} style={{padding:"8px 20px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Crea Progetto</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── VISTA PROGETTO ──
  const TABS_PROG=[
    {k:"overview",l:"📊 Overview"},
    {k:"analytics",l:"📈 Analytics"},
    {k:"ottimizzazione",l:"⇌ Ottimizzazione"},
    {k:"parametri",l:"⚙ Parametri"},
    {k:"combinazioni",l:"🔬 Combinazioni"},
    {k:"trade",l:"📋 Trade"},
  ];

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* HEADER */}
      <div style={{padding:"11px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:c.sb,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button onClick={function(){setView("lista");}} style={{padding:"4px 9px",borderRadius:6,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>← Backtest</button>
          <div>
            <div style={{fontSize:14,fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
              {progettoCorrente?.nome||"—"}
              <Tooltip text="Progetto Backtest: inserisci trade storici o importa quelli live, assegna i parametri usati per ogni trade e analizza quali combinazioni performano meglio." c={c}/>
            </div>
            <div style={{fontSize:9,color:c.txm}}>{progettoCorrente?.asset||""}{progettoCorrente?.timeframe?" · "+progettoCorrente.timeframe:""} · {tradesCorrente.length} trade</div>
          </div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={function(){setShowImport(true);}} style={{padding:"6px 12px",borderRadius:7,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>⬇ Importa Live</button>
          <button onClick={function(){setEditingTrade(null);setTForm(initTForm(lastBtDate));setShowNuovoTrade(true);}} style={{padding:"6px 14px",borderRadius:7,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>+ Trade</button>
        </div>
      </div>

      {/* TABS */}
      <div style={{padding:"0 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:2,flexShrink:0,overflowX:"auto"}}>
        {TABS_PROG.map(function(t){const a=anTab===t.k;return(
          <button key={t.k} onClick={function(){setAnTab(t.k);}} style={{padding:"8px 14px",border:"none",borderBottom:"2px solid "+(a?c.ac:"transparent"),background:"transparent",color:a?c.ac:c.txm,fontSize:11,fontWeight:a?700:400,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>{t.l}</button>
        );})}
      </div>

      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        <DisclaimerCampione n={tradesCorrente.length} c={c}/>

        {/* ── OVERVIEW ── */}
        {anTab==="overview"&&(
          <div>
            {tradesCorrente.length===0?(
              <div style={{textAlign:"center",padding:"40px",color:c.txm,fontSize:12}}>Inserisci o importa trade per vedere le analisi.</div>
            ):(
              <>
                <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:12}}>
                  {[
                    {l:"Trade Totali",v:metGlobali.total,col:c.tx,tt:"Numero totale di trade inseriti in questo progetto backtest. Più trade hai, più affidabili sono le statistiche — sotto 30 trade i risultati sono indicativi, non definitivi."},
                    {l:"Win Rate",v:metGlobali.wr+"%",col:metGlobali.wr>=50?c.gr:c.rd,tt:"% trade chiusi in profitto (R>0) sul totale."},
                    {l:"Profit Factor",v:metGlobali.pf,col:metGlobali.pf>=1.5?c.gr:metGlobali.pf>=1?c.am:c.rd,tt:"Gross Profit / Gross Loss. >1.5 = edge solida. <1 = strategia perdente."},
                    {l:"Expectancy",v:fmtR(metGlobali.exp),col:metGlobali.exp>=0?c.gr:c.rd,tt:"R medio per trade. Expectancy positiva = sistema profittevole a lungo termine."},
                    {l:"Max Drawdown",v:"-"+metGlobali.maxDD+"R",col:c.rd,tt:"Massima perdita cumulativa dal picco. Misura il rischio di perdita sostenuta."},
                    {l:"Total R",v:fmtR(metGlobali.totalR),col:metGlobali.totalR>=0?c.gr:c.rd,tt:"La somma di tutti i risultati in R del campione backtest. È la misura più pura della profittabilità perché non dipende dalla size o dal capitale. Positivo = il setup è profittevole, negativo = il setup perde nel lungo periodo."},
                  ].map(function(m,i){return(
                    <div key={i} style={{background:c.card,borderRadius:10,padding:"11px 12px",border:"1px solid "+c.bd}}>
                      <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:3,display:"flex",alignItems:"center"}}>{m.l}<Tooltip text={m.tt} c={c}/></div>
                      <div style={{fontSize:15,fontWeight:800,color:m.col}}>{m.v}</div>
                    </div>
                  );})}
                </div>
                {/* Equity curve */}
                {eqCurve.length>1&&(
                  <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
                    <div style={{fontSize:11,fontWeight:700,marginBottom:8}}>Equity Curve</div>
                    <EqChartSVG curve={eqCurve} c={c} h={120} unit="R"/>
                  </div>
                )}
                {/* Per-parametro overview */}
                {paramStats.length>0&&(
                  <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd}}>
                    <div style={{fontSize:11,fontWeight:700,marginBottom:10}}>Performance per Parametro</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                      {paramStats.map(function(p,i){return(
                        <div key={i} style={{padding:"9px 12px",borderRadius:9,background:c.bg,border:"1px solid "+c.bd,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div>
                            <span style={{fontSize:9,fontWeight:700,color:famColors[p.famiglia]||c.ac,background:(famColors[p.famiglia]||c.ac)+"15",padding:"2px 6px",borderRadius:4}}>{famLabels[p.famiglia]}</span>
                            <div style={{fontSize:12,fontWeight:600,marginTop:4}}>{p.nome}</div>
                            <div style={{fontSize:10,color:c.txm}}>n={p.n} · WR {p.wr}%</div>
                          </div>
                          <div style={{textAlign:"right"}}>
                            <div style={{fontSize:14,fontWeight:800,color:p.exp>=0?c.gr:c.rd}}>{fmtR(p.exp)}</div>
                            <div style={{fontSize:9,color:c.txm}}>PF {p.pf}</div>
                          </div>
                        </div>
                      );})}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── PARAMETRI ── */}
        {anTab==="parametri"&&(
          <div style={{maxWidth:600}}>
            <div style={{fontSize:11,color:c.txm,marginBottom:12,lineHeight:1.6}}>
              Definisci i parametri del tuo sistema di trading in 5 famiglie. Per ogni trade backtest potrai spuntare quali parametri erano presenti, e EdgeLab calcolerà automaticamente le performance per ogni combinazione.
            </div>
            {["direzionalita","trigger","confluenze_pro","confluenze_contro","extra"].map(function(fam){
              const items=progettoCorrente?.parametri?.[fam]||[];
              return(
                <div key={fam} style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                    <span style={{fontSize:11,fontWeight:700,color:famColors[fam],background:famColors[fam]+"15",padding:"3px 10px",borderRadius:20}}>{famLabels[fam]}</span>
                    <span style={{fontSize:10,color:c.txm}}>{items.length} parametri</span>
                  </div>
                  {items.length===0&&<div style={{fontSize:11,color:c.txs,marginBottom:8}}>Nessun parametro ancora. Aggiungine uno sotto.</div>}
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
                    {items.map(function(item,idx){return(
                      <span key={idx} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"4px 10px",borderRadius:20,background:famColors[fam]+"15",border:"1px solid "+famColors[fam]+"40",fontSize:11,color:famColors[fam]}}>
                        {item}
                        <button onClick={function(){removeParametro(fam,idx);}} style={{background:"none",border:"none",color:famColors[fam],cursor:"pointer",fontSize:10,padding:0,opacity:0.7}}
                          onMouseEnter={function(e){e.currentTarget.style.opacity=1;}} onMouseLeave={function(e){e.currentTarget.style.opacity=0.7;}}>✕</button>
                      </span>
                    );})}
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <input
                      value={newParam.famiglia===fam?newParam.nome:""}
                      onFocus={function(){setNewParam(function(p){return {...p,famiglia:fam};});}}
                      onChange={function(e){setNewParam({famiglia:fam,nome:e.target.value});}}
                      onKeyDown={function(e){if(e.key==="Enter")addParametro();}}
                      placeholder={"+ Aggiungi "+famLabels[fam].toLowerCase()+"..."}
                      style={{flex:1,padding:"6px 10px",borderRadius:7,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none"}}
                    />
                    <button onClick={addParametro} style={{padding:"6px 12px",borderRadius:7,background:famColors[fam],border:"none",color:"#fff",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── TRADE ── */}
        {anTab==="trade"&&(
          <div>
            {tradesCorrente.length===0?(
              <div style={{textAlign:"center",padding:"40px",color:c.txm,fontSize:12}}>Nessun trade. Aggiungine uno o importa da live.</div>
            ):(
              <div style={{background:c.card,borderRadius:12,border:"1px solid "+c.bd,overflow:"hidden"}}>
                <div style={{display:"grid",gridTemplateColumns:"90px 50px 80px 60px 60px auto 60px",gap:0,padding:"8px 14px",background:c.bg,borderBottom:"1px solid "+c.bd}}>
                  {["Data","Dir.","R","MAE","Conf.","Parametri",""].map(function(h,i){return <div key={i} style={{fontSize:8,color:c.txs,fontWeight:700,letterSpacing:"0.05em"}}>{h}</div>;})}
                </div>
                {tradesCorrente.slice().sort(function(a,b){return new Date(b.data_apertura)-new Date(a.data_apertura);}).map(function(t,i,arr){
                  const maeR=null;// MAE rimosso
                  return(
                  <div key={t.id} style={{display:"grid",gridTemplateColumns:"90px 50px 80px 60px 60px auto 60px",gap:0,padding:"9px 14px",borderBottom:i<arr.length-1?"1px solid "+c.bdl:"none",alignItems:"center"}}>
                    <div>
                      <div style={{fontSize:11,fontWeight:600}}>{fmtDate(t.data_apertura)}</div>
                      {t.note&&<div style={{fontSize:8,color:c.txm,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:85}} title={t.note}>{t.note}</div>}
                    </div>
                    <div><span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:26,height:16,borderRadius:3,fontSize:9,fontWeight:700,background:t.direzione==="L"?c.gr+"18":c.rd+"18",color:t.direzione==="L"?c.gr:c.rd}}>{t.direzione==="L"?"▲L":"▼S"}</span></div>
                    <div><Badge v={t.r_result} c={c}/></div>
                    <div style={{fontSize:10,color:maeR!=null?maeR>1?c.rd:c.am:c.txm}}>{maeR!=null?"-"+maeR+"R":"—"}</div>
                    <div style={{fontSize:11}}>{t.confidence>0?"⭐".repeat(t.confidence):<span style={{color:c.txm,fontSize:9}}>—</span>}</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                      {(t.params||[]).length===0?<span style={{fontSize:9,color:c.txs}}>nessuno</span>:(t.params||[]).map(function(p,pi){
                        const fam=allParams.find(function(a){return a.nome===p;})?.famiglia||"extra";
                        return <span key={pi} style={{fontSize:9,padding:"2px 6px",borderRadius:10,background:(famColors[fam]||c.ac)+"15",color:(famColors[fam]||c.ac),border:"1px solid "+(famColors[fam]||c.ac)+"30"}}>{p}</span>;
                      })}
                    </div>
                    <div style={{display:"flex",gap:6,justifyContent:"flex-end",alignItems:"center"}}>
                      <div onClick={function(){editaTrade(t);}} style={{fontSize:11,color:c.ac,cursor:"pointer",opacity:0.5,padding:"2px 4px"}}
                        title="Modifica trade"
                        onMouseEnter={function(e){e.currentTarget.style.opacity=1;}} onMouseLeave={function(e){e.currentTarget.style.opacity=0.5;}}>✏️</div>
                      <div onClick={function(){eliminaTrade(t.id);}} style={{fontSize:11,color:c.rd,cursor:"pointer",opacity:0.5,padding:"2px 4px"}}
                        title="Elimina trade"
                        onMouseEnter={function(e){e.currentTarget.style.opacity=1;}} onMouseLeave={function(e){e.currentTarget.style.opacity=0.5;}}>✕</div>
                    </div>
                  </div>
                );})}
              </div>
            )}
          </div>
        )}

        {/* ── COMBINAZIONI ── */}
        {anTab==="combinazioni"&&(
          <div>
            <div style={{fontSize:11,color:c.txm,marginBottom:12,lineHeight:1.6}}>
              Combinazioni di parametri più performanti, ordinate per Expectancy decrescente. Richiede almeno 2 trade per combinazione.
            </div>
            {topCombo.length===0?(
              <div style={{textAlign:"center",padding:"40px",color:c.txm,fontSize:12}}>Inserisci più trade con parametri assegnati per vedere le combinazioni migliori.</div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {topCombo.map(function(combo,i){return(
                  <div key={i} style={{background:c.card,borderRadius:11,padding:"13px 16px",border:"1px solid "+c.bd,display:"flex",alignItems:"center",gap:14}}>
                    <div style={{width:26,height:26,borderRadius:7,background:i===0?"linear-gradient(135deg,#F59E0B,#D97706)":i===1?"linear-gradient(135deg,#9CA3AF,#6B7280)":i===2?"linear-gradient(135deg,#B45309,#92400E)":c.tag,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:i<3?"#fff":c.txm,flexShrink:0}}>#{i+1}</div>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:4}}>
                        {combo.nomi.map(function(n,ni){
                          const fam=allParams.find(function(a){return a.nome===n;})?.famiglia||"extra";
                          return <span key={ni} style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:(famColors[fam]||c.ac)+"15",color:(famColors[fam]||c.ac),border:"1px solid "+(famColors[fam]||c.ac)+"30",fontWeight:600}}>{n}</span>;
                        })}
                      </div>
                      <div style={{fontSize:10,color:c.txm}}>n={combo.n} trade · WR {combo.wr}% · PF {combo.pf} · MaxDD -{combo.maxDD}R</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontSize:16,fontWeight:800,color:combo.exp>=0?c.gr:c.rd}}>{fmtR(combo.exp)}</div>
                      <div style={{fontSize:9,color:c.txm}}>per trade</div>
                    </div>
                  </div>
                );})}
              </div>
            )}
          </div>
        )}

        {/* ── ANALYTICS ── */}
        {anTab==="analytics"&&(function(){
          if(tradesCorrente.length<3) return(
            <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:12}}>
              <div style={{fontSize:28,marginBottom:10}}>📈</div>
              <div style={{fontWeight:700,marginBottom:4}}>Dati insufficienti</div>
              <div>Inserisci almeno 3 trade per vedere le analytics.</div>
            </div>
          );
          const sorted=tradesCorrente.slice().sort(function(a,b){return new Date(a.data_apertura)-new Date(b.data_apertura);});
          // Giorni settimana
          const DAYS=["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
          const dayMap={};
          sorted.forEach(function(t){
            const d=DAYS[new Date(t.data_apertura).getDay()]||"?";
            if(!dayMap[d]) dayMap[d]={d,total:0,wins:0,totalR:0};
            dayMap[d].total++;
            if(t.r_result>0) dayMap[d].wins++;
            dayMap[d].totalR+=t.r_result||0;
          });
          const dayData=DAYS.map(function(d){return dayMap[d]||{d,total:0,wins:0,totalR:0};});
          // Orari (UTC)
          const hourMap={};
          sorted.forEach(function(t){
            const h=getHourWithTz(t.data_apertura);
            if(!hourMap[h]) hourMap[h]={h,total:0,wins:0,totalR:0};
            hourMap[h].total++;
            if(t.r_result>0) hourMap[h].wins++;
            hourMap[h].totalR+=t.r_result||0;
          });
          const hourData=Array.from({length:24},function(_,h){return hourMap[h]||{h,total:0,wins:0,totalR:0};});
          // Sessioni
          // usa getSessioneLocal globale con ora legale EU
          const sessMap={Asian:{s:"Asian",total:0,wins:0,totalR:0},London:{s:"London",total:0,wins:0,totalR:0},NY:{s:"NY",total:0,wins:0,totalR:0}};
          sorted.forEach(function(t){const s=getSessioneWithTz(t.data_apertura);sessMap[s].total++;if(t.r_result>0)sessMap[s].wins++;sessMap[s].totalR+=t.r_result||0;});
          const sessData=Object.values(sessMap).filter(function(s){return s.total>0;});
          // Long vs Short
          const longTs=sorted.filter(function(t){return t.direzione==="L";});
          const shortTs=sorted.filter(function(t){return t.direzione==="S";});
          const mL=calcMetrics(longTs);const mS=calcMetrics(shortTs);
          // Distribuzione R
          const rBuckets={};
          sorted.forEach(function(t){
            const bucket=parseFloat((Math.floor(t.r_result*2)/2).toFixed(1));
            if(!rBuckets[bucket]) rBuckets[bucket]={r:bucket,n:0,wins:0};
            rBuckets[bucket].n++;
            if(t.r_result>0) rBuckets[bucket].wins++;
          });
          const rDist=Object.values(rBuckets).sort(function(a,b){return a.r-b.r;});
          const maxRN=Math.max(...rDist.map(function(b){return b.n;}),1);
          // MAE/MFE stats
          const mfeTrades=sorted.filter(function(t){return t.mfe!=null;});
          const maeTrades=sorted.filter(function(t){return t.mae!=null&&t.entry&&t.sl;});
          const mfeRs=mfeTrades.map(function(t){return parseFloat(t.mfe)||0;}).filter(function(v){return v!=null;});
          const maeRs=[];// MAE rimosso
          const avgMFE=mfeRs.length>0?(mfeRs.reduce(function(a,b){return a+b;},0)/mfeRs.length).toFixed(2):null;
          const avgMAE=maeRs.length>0?(maeRs.reduce(function(a,b){return a+b;},0)/maeRs.length).toFixed(2):null;
          // Confidence stats
          const confTs=sorted.filter(function(t){return t.confidence>0;});
          const confMap={};
          confTs.forEach(function(t){
            const k=t.confidence;
            if(!confMap[k]) confMap[k]={k,total:0,wins:0,totalR:0};
            confMap[k].total++;if(t.r_result>0)confMap[k].wins++;confMap[k].totalR+=t.r_result||0;
          });
          const confData=[1,2,3,4,5].map(function(k){return confMap[k]||{k,total:0,wins:0,totalR:0};});
          return(
            <>
              {/* Long vs Short */}
              <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,marginBottom:10}}>Long vs Short</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  {[{l:"▲ Long",m:mL,col:c.gr,ts:longTs},{l:"▼ Short",m:mS,col:c.rd,ts:shortTs}].map(function(side){
                    return(
                      <div key={side.l} style={{background:c.bg,borderRadius:9,padding:"12px 14px",border:"1px solid "+c.bd}}>
                        <div style={{fontSize:12,fontWeight:700,color:side.col,marginBottom:8}}>{side.l} <span style={{fontSize:9,color:c.txm,fontWeight:400}}>({side.ts.length} trade)</span></div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                          {[
                            {l:"Win Rate",v:side.m.wr+"%",col:side.m.wr>=50?c.gr:c.rd},
                            {l:"Expectancy",v:fmtR(side.m.exp),col:side.m.exp>=0?c.gr:c.rd},
                            {l:"Profit Factor",v:side.m.pf,col:side.m.pf>=1.5?c.gr:side.m.pf>=1?c.am:c.rd},
                            {l:"Max DD",v:"-"+side.m.maxDD+"R",col:c.rd},
                            {l:"Avg Win",v:"+"+side.m.avgWin+"R",col:c.gr},
                            {l:"Avg Loss",v:"-"+side.m.avgLoss+"R",col:c.rd},
                          ].map(function(mm,i){return(
                            <div key={i} style={{background:c.card,borderRadius:7,padding:"6px 8px"}}>
                              <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:1}}>{mm.l}</div>
                              <div style={{fontSize:12,fontWeight:700,color:mm.col}}>{mm.v}</div>
                            </div>
                          );})}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Giorni settimana */}
              <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,marginBottom:10}}>Performance per Giorno della Settimana</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6}}>
                  {dayData.map(function(d){
                    const wr=d.total>0?Math.round(d.wins/d.total*100):0;
                    const exp=d.total>0?parseFloat((d.totalR/d.total).toFixed(2)):0;
                    const col=d.total===0?c.txm:exp>0?c.gr:exp<0?c.rd:c.am;
                    return(
                      <div key={d.d} style={{background:c.bg,borderRadius:8,padding:"10px 6px",textAlign:"center",border:"1px solid "+(d.total>0&&exp>0.1?c.gr+"30":d.total>0&&exp<-0.1?c.rd+"30":c.bd)}}>
                        <div style={{fontSize:10,fontWeight:700,marginBottom:4}}>{d.d}</div>
                        <div style={{fontSize:9,color:c.txm,marginBottom:4}}>{d.total} trade</div>
                        {d.total>0?(
                          <>
                            <div style={{fontSize:11,fontWeight:700,color:col}}>{exp>0?"+":""}{exp}R</div>
                            <div style={{fontSize:9,color:wr>=50?c.gr:c.rd}}>{wr}%</div>
                          </>
                        ):<div style={{fontSize:9,color:c.txm}}>—</div>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Orari UTC */}
              <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,marginBottom:4}}>Performance per Ora (UTC)</div>
                <div style={{fontSize:9,color:c.txm,marginBottom:10}}>Verde = ora profittevole · Rosso = ora da evitare · Altezza = numero trade</div>
                {(function(){
                  const activeHours=hourData.filter(function(h){return h.total>0;});
                  if(activeHours.length===0) return <div style={{textAlign:"center",color:c.txm,fontSize:11,padding:"20px"}}>Nessun trade con data.</div>;
                  const maxH=Math.max(...activeHours.map(function(h){return h.total;}),1);
                  const maxAbs=Math.max(...activeHours.map(function(h){return Math.abs(h.totalR/Math.max(h.total,1));}),0.01);
                  return(
                    <>
                      <div style={{display:"flex",gap:2,alignItems:"flex-end",height:80,marginBottom:4}}>
                        {hourData.map(function(h){
                          const exp=h.total>0?h.totalR/h.total:0;
                          const pct=maxH>0?(h.total/maxH):0;
                          const col=h.total===0?c.bd+"40":exp>0?c.gr:exp<0?c.rd:c.am;
                          return(
                            <div key={h.h} title={h.h+":00 UTC — "+h.total+" trade, Exp "+(h.total>0?(exp>0?"+":"")+exp.toFixed(2)+"R":"—")} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                              <div style={{width:"100%",height:Math.max(pct*70,h.total>0?4:0),background:col,borderRadius:"3px 3px 0 0",opacity:h.total>0?0.85:0.2}}/>
                              <div style={{fontSize:6,color:c.txm}}>{h.h}</div>
                            </div>
                          );
                        })}
                      </div>
                      {/* Top 3 ore migliori */}
                      {activeHours.length>=2&&(function(){
                        const ranked=activeHours.slice().sort(function(a,b){return (b.totalR/b.total)-(a.totalR/a.total);});
                        const best=ranked.slice(0,3);
                        const worst=ranked.slice(-3).reverse();
                        return(
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:8}}>
                            <div style={{background:c.gr+"08",borderRadius:8,padding:"8px 10px",border:"1px solid "+c.gr+"20"}}>
                              <div style={{fontSize:9,fontWeight:700,color:c.gr,marginBottom:4}}>🕐 ORE MIGLIORI</div>
                              {best.map(function(h){return <div key={h.h} style={{fontSize:10,color:c.tx,marginBottom:2}}>{h.h}:00 UTC — {(h.totalR/h.total>0?"+":"")+(h.totalR/h.total).toFixed(2)}R · {h.total} trade</div>;})}
                            </div>
                            <div style={{background:c.rd+"08",borderRadius:8,padding:"8px 10px",border:"1px solid "+c.rd+"20"}}>
                              <div style={{fontSize:9,fontWeight:700,color:c.rd,marginBottom:4}}>🕐 ORE PEGGIORI</div>
                              {worst.map(function(h){return <div key={h.h} style={{fontSize:10,color:c.tx,marginBottom:2}}>{h.h}:00 UTC — {(h.totalR/h.total>0?"+":"")+(h.totalR/h.total).toFixed(2)}R · {h.total} trade</div>;})}
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  );
                })()}
              </div>

              {/* Sessioni */}
              <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,marginBottom:10}}>Performance per Sessione</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                  {[{s:"Asian",col:"#D97706"},{s:"London",col:"#4F46E5"},{s:"NY",col:"#0F766E"}].map(function(sc){
                    const sd=sessMap[sc.s];
                    const wr=sd.total>0?Math.round(sd.wins/sd.total*100):0;
                    const exp=sd.total>0?parseFloat((sd.totalR/sd.total).toFixed(2)):0;
                    return(
                      <div key={sc.s} style={{background:sc.col+"0C",borderRadius:10,padding:"12px 14px",border:"1px solid "+sc.col+"25"}}>
                        <div style={{fontSize:11,fontWeight:700,color:sc.col,marginBottom:6}}>{sc.s}</div>
                        <div style={{fontSize:9,color:c.txm,marginBottom:6}}>{sd.total} trade</div>
                        {sd.total>0?(
                          <>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                              <div><div style={{fontSize:8,color:c.txm}}>Win%</div><div style={{fontSize:13,fontWeight:700,color:wr>=50?c.gr:c.rd}}>{wr}%</div></div>
                              <div><div style={{fontSize:8,color:c.txm}}>Exp</div><div style={{fontSize:13,fontWeight:700,color:exp>=0?c.gr:c.rd}}>{exp>=0?"+":""}{exp}R</div></div>
                            </div>
                            <div style={{marginTop:6,height:4,borderRadius:2,background:c.bd,overflow:"hidden"}}>
                              <div style={{width:wr+"%",height:"100%",background:sc.col,borderRadius:2}}/>
                            </div>
                          </>
                        ):<div style={{fontSize:10,color:c.txm}}>Nessun trade</div>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Distribuzione R */}
              <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,marginBottom:4}}>Distribuzione R — Istogramma</div>
                <div style={{fontSize:9,color:c.txm,marginBottom:10}}>Quante volte hai chiuso a ogni livello di R</div>
                {rDist.length===0?<div style={{textAlign:"center",color:c.txm,fontSize:11,padding:"20px"}}>Nessun dato.</div>:(
                  <div style={{display:"flex",gap:3,alignItems:"flex-end",height:90}}>
                    {rDist.map(function(b){
                      const pct=b.n/maxRN;
                      const col=b.r>0?c.gr:b.r<0?c.rd:c.am;
                      return(
                        <div key={b.r} title={b.r+"R: "+b.n+" trade"} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                          <div style={{fontSize:7,color:col,fontWeight:700}}>{b.n}</div>
                          <div style={{width:"100%",height:Math.max(pct*70,4),background:col,borderRadius:"3px 3px 0 0",opacity:0.8}}/>
                          <div style={{fontSize:6.5,color:c.txm,whiteSpace:"nowrap"}}>{b.r}R</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* MAE / MFE stats */}
              {(mfeRs.length>0||maeRs.length>0)&&(
                <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:700,marginBottom:10}}>MAE / MFE in R</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                    {maeRs.length>0&&(
                      <div style={{background:c.rd+"08",borderRadius:9,padding:"12px",border:"1px solid "+c.rd+"20"}}>
                        <div style={{fontSize:9,fontWeight:700,color:c.rd,marginBottom:4}}>MAE — Excursion avversa</div>
                        <div style={{fontSize:18,fontWeight:800,color:c.rd}}>-{avgMAE}R</div>
                        <div style={{fontSize:9,color:c.txm}}>avg su {maeRs.length} trade · SL viene testato mediamente a -{avgMAE}R dal entry</div>
                      </div>
                    )}
                    {mfeRs.length>0&&(
                      <div style={{background:c.gr+"08",borderRadius:9,padding:"12px",border:"1px solid "+c.gr+"20"}}>
                        <div style={{fontSize:9,fontWeight:700,color:c.gr,marginBottom:4}}>MFE — Excursion favorevole</div>
                        <div style={{fontSize:18,fontWeight:800,color:c.gr}}>+{avgMFE}R</div>
                        <div style={{fontSize:9,color:c.txm}}>avg su {mfeRs.length} trade · il prezzo arriva mediamente a +{avgMFE}R prima di tornare</div>
                      </div>
                    )}
                  </div>
                  {/* MFE scatter: ogni trade come punto */}
                  {mfeRs.length>=3&&(function(){
                    const maxMfe=Math.max(...mfeRs,1);
                    const mfeFull=mfeTrades.map(function(t){

                      const mR=parseFloat(t.mfe)||0;
                      return {mR,r:t.r_result,date:fmtDate(t.data_apertura)};
                    }).filter(Boolean).sort(function(a,b){return a.mR-b.mR;});
                    return(
                      <div>
                        <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:6,textTransform:"uppercase"}}>MFE distribution — ogni barra = 1 trade</div>
                        <div style={{display:"flex",gap:2,alignItems:"flex-end",height:60}}>
                          {mfeFull.map(function(d,i){
                            const pct=maxMfe>0?Math.min(d.mR/maxMfe,1):0;
                            return(
                              <div key={i} title={"MFE: +"+d.mR+"R | Exit: "+fmtR(d.r)+" | "+d.date}
                                style={{flex:1,height:Math.max(pct*55,3),background:d.r>0?c.gr:c.rd,borderRadius:"2px 2px 0 0",opacity:0.75,cursor:"default"}}/>
                            );
                          })}
                        </div>
                        <div style={{fontSize:8,color:c.txm,marginTop:2}}>🟢 trade chiuso in win · 🔴 trade chiuso in loss</div>
                      </div>
                    );
                  })()}
                  {/* Insight: quanti trade arrivano a 2R di MFE ma vengono chiusi in loss? */}
                  {(function(){
                    if(mfeTrades.length<3) return null;
                    const arr=mfeTrades.map(function(t){

                      const mR=parseFloat(t.mfe)||0;
                      return {mR,r:t.r_result};
                    }).filter(Boolean);
                    const reached2R=arr.filter(function(d){return d.mR>=2;});
                    const reached2RLoss=reached2R.filter(function(d){return d.r<0;});
                    if(reached2R.length===0) return null;
                    const wastedPct=Math.round(reached2RLoss.length/reached2R.length*100);
                    return(
                      <div style={{marginTop:10,padding:"10px 12px",borderRadius:8,background:wastedPct>30?c.rd+"10":c.gr+"08",border:"1px solid "+(wastedPct>30?c.rd:c.gr)+"25",fontSize:11,lineHeight:1.6}}>
                        {wastedPct>30
                          ? "⚠ "+reached2RLoss.length+" trade su "+reached2R.length+" ("+wastedPct+"%) hanno raggiunto +2R di MFE ma sono stati chiusi in loss. Il tuo TP è troppo alto o stai movendo lo SL in perdita."
                          : "✅ Solo "+reached2RLoss.length+" trade su "+reached2R.length+" ("+wastedPct+"%) che arrivano a +2R di MFE finiscono in loss. Ottima gestione delle posizioni favorevoli."}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Confidence stars */}
              {confTs.length>0&&(
                <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:700,marginBottom:10}}>Performance per Confidence ⭐</div>
                  <div style={{background:c.card,borderRadius:10,border:"1px solid "+c.bd,overflow:"hidden"}}>
                    <div style={{display:"grid",gridTemplateColumns:"100px 70px 70px 80px 80px",padding:"7px 14px",background:c.tag,gap:0}}>
                      {["Confidence","Trade","Win%","Expectancy","Total R"].map(function(h){return <div key={h} style={{fontSize:9,fontWeight:700,color:c.txm,textTransform:"uppercase",letterSpacing:"0.05em"}}>{h}</div>;})}
                    </div>
                    {confData.filter(function(d){return d.total>0;}).map(function(d){
                      const wr=d.total>0?Math.round(d.wins/d.total*100):0;
                      const exp=d.total>0?parseFloat((d.totalR/d.total).toFixed(2)):0;
                      return(
                        <div key={d.k} style={{display:"grid",gridTemplateColumns:"100px 70px 70px 80px 80px",padding:"9px 14px",borderTop:"1px solid "+c.bdl,gap:0,alignItems:"center"}}>
                          <div style={{fontSize:12}}>{"⭐".repeat(d.k)}</div>
                          <div style={{fontSize:11}}>{d.total}</div>
                          <div style={{fontSize:12,fontWeight:700,color:wr>=50?c.gr:c.rd}}>{wr}%</div>
                          <div style={{fontSize:12,fontWeight:700,color:exp>=0?c.gr:c.rd}}>{exp>=0?"+":""}{exp}R</div>
                          <div style={{fontSize:11,fontWeight:600,color:d.totalR>=0?c.gr:c.rd}}>{d.totalR>=0?"+":""}{parseFloat(d.totalR.toFixed(2))}R</div>
                        </div>
                      );
                    })}
                  </div>
                  {(function(){
                    const best=confData.filter(function(d){return d.total>=2;}).sort(function(a,b){return (b.totalR/b.total)-(a.totalR/a.total);})[0];
                    const worst=confData.filter(function(d){return d.total>=2;}).sort(function(a,b){return (a.totalR/a.total)-(b.totalR/b.total);})[0];
                    if(!best||!worst||best.k===worst.k) return null;
                    return(
                      <div style={{marginTop:8,padding:"9px 12px",borderRadius:8,background:c.ac+"08",border:"1px solid "+c.ac+"20",fontSize:11,lineHeight:1.6}}>
                        ⭐ I trade con confidence {"⭐".repeat(best.k)} hanno la miglior expectancy ({(best.totalR/best.total).toFixed(2)}R). Quelli con {"⭐".repeat(worst.k)} sono i peggiori ({(worst.totalR/worst.total).toFixed(2)}R). Considera di skippare i setup a bassa confidence.
                      </div>
                    );
                  })()}
                </div>
              )}
            </>
          );
        })()}

        {/* ── OTTIMIZZAZIONE ── */}
        {anTab==="ottimizzazione"&&(function(){
          const hasMFE=tradesCorrente.filter(function(t){return t.mfe!=null;}).length>=3;

          // arricchisce ogni trade con mfeR (già in R)
          const enriched=tradesCorrente.map(function(t){
            const mfeR=t.mfe!=null?parseFloat(t.mfe):null;
            const maeR=null;// MAE rimosso
            return {...t,mfeR,maeR};
          });

          // Ottimizzazione TP automatica
          function simTP(tpR){
            return enriched.filter(function(t){return t.mfeR!=null;}).map(function(t){
              let r;
              if(t.mfeR>=tpR) r=tpR; // TP raggiunto
              else r=t.r_result; // TP non raggiunto, esce dove esce
              return r;
            });
          }

          const tpOptions=[0.5,0.75,1,1.25,1.5,1.75,2,2.5,3,3.5,4,5];
          const tpResults=tpOptions.map(function(tp){
            const rs=simTP(tp);
            if(rs.length===0) return {tp,exp:0,wr:0,totalR:0,n:rs.length};
            const wins=rs.filter(function(r){return r>0;}).length;
            const totalR=parseFloat(rs.reduce(function(a,b){return a+b;},0).toFixed(2));
            const exp=parseFloat((totalR/rs.length).toFixed(2));
            return {tp,exp,wr:Math.round(wins/rs.length*100),totalR,n:rs.length};
          });
          const bestTP=tpResults.slice().sort(function(a,b){return b.exp-a.exp;})[0];

          // Ottimizzazione BE automatica
          function simBE(beR){
            return enriched.filter(function(t){return t.mfeR!=null;}).map(function(t){
              if(t.mfeR>=beR) return Math.max(t.r_result,0); // BE attivato: non perdi
              return t.r_result;
            });
          }
          const beOptions=[0.5,0.75,1,1.25,1.5,1.75,2];
          const beResults=beOptions.map(function(be){
            const rs=simBE(be);
            if(rs.length===0) return {be,exp:0,wr:0,totalR:0,dd:0};
            const wins=rs.filter(function(r){return r>0;}).length;
            const totalR=parseFloat(rs.reduce(function(a,b){return a+b;},0).toFixed(2));
            const exp=parseFloat((totalR/rs.length).toFixed(2));
            let peak=0,dd=0,eq=0;
            rs.forEach(function(r){eq+=r;if(eq>peak)peak=eq;if(peak-eq>dd)dd=peak-eq;});
            return {be,exp,wr:Math.round(wins/rs.length*100),totalR,dd:parseFloat(dd.toFixed(2))};
          });
          const bestBE=beResults.slice().sort(function(a,b){return b.exp-a.exp;})[0];

          // Simulatore manuale
          function simManuale(){
            return enriched.filter(function(t){return t.mfeR!=null;}).map(function(t){
              let remainingSize=1;let totalR=0;
              // Parziale
              if(simParz1Pct>0&&simParz1R>0&&t.mfeR>=simParz1R){
                totalR+=simParz1R*(simParz1Pct/100);
                remainingSize-=(simParz1Pct/100);
              }
              // BE
              const beActive=simBeR>0&&t.mfeR>=simBeR;
              // TP o exit originale
              if(t.mfeR>=simTpR) totalR+=simTpR*remainingSize;
              else if(beActive) totalR+=0; // BE: esce a 0
              else totalR+=t.r_result*remainingSize;
              return parseFloat(totalR.toFixed(2));
            });
          }

          const simRs=simManuale();
          const simWins=simRs.filter(function(r){return r>0;}).length;
          const simTotalR=parseFloat(simRs.reduce(function(a,b){return a+b;},0).toFixed(2));
          const simExp=simRs.length>0?parseFloat((simTotalR/simRs.length).toFixed(2)):0;
          const simWR=simRs.length>0?Math.round(simWins/simRs.length*100):0;
          let simPeak=0,simDD=0,simEq=0;
          simRs.forEach(function(r){simEq+=r;if(simEq>simPeak)simPeak=simEq;if(simPeak-simEq>simDD)simDD=simPeak-simEq;});

          // Equity curve originale vs simulata
          const sortedEq=enriched.filter(function(t){return t.mfeR!=null;}).sort(function(a,b){return new Date(a.data_apertura)-new Date(b.data_apertura);});
          const origRs=sortedEq.map(function(t){return t.r_result;});
          const manRs=sortedEq.map(function(t){
            let remainingSize=1;let totalR=0;
            if(simParz1Pct>0&&simParz1R>0&&t.mfeR>=simParz1R){totalR+=simParz1R*(simParz1Pct/100);remainingSize-=(simParz1Pct/100);}
            const beActive=simBeR>0&&t.mfeR>=simBeR;
            if(t.mfeR>=simTpR) totalR+=simTpR*remainingSize;
            else if(beActive) totalR+=0;
            else totalR+=t.r_result*remainingSize;
            return parseFloat(totalR.toFixed(2));
          });
          // build dual equity
          let cumOrig=0,cumMan=0;
          const dualEq=[{i:0,orig:0,man:0}];
          origRs.forEach(function(r,i){cumOrig+=r;cumMan+=manRs[i];dualEq.push({i:i+1,orig:parseFloat(cumOrig.toFixed(2)),man:parseFloat(cumMan.toFixed(2))});});
          const maxDualEq=Math.max(...dualEq.map(function(p){return Math.max(Math.abs(p.orig),Math.abs(p.man));}),1);

          if(!hasMFE) return(
            <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:12}}>
              <div style={{fontSize:28,marginBottom:10}}>⇌</div>
              <div style={{fontWeight:700,marginBottom:6}}>MFE necessario</div>
              <div style={{lineHeight:1.6}}>Inserisci il prezzo MFE su almeno 3 trade per abilitare l'ottimizzazione.<br/>MFE = il prezzo più favorevole raggiunto durante il trade, prima di tornare indietro.</div>
            </div>
          );

          return(
            <>
              {/* Riepilogo auto-ottimizzazione */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.ac+"40"}}>
                  <div style={{fontSize:10,fontWeight:700,color:c.ac,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>🎯 TP Ottimale (automatico)</div>
                  <div style={{fontSize:28,fontWeight:800,color:c.ac,marginBottom:4}}>{bestTP?.tp}R</div>
                  <div style={{fontSize:11,color:c.txm,marginBottom:8}}>Exp {bestTP?.exp>=0?"+":""}{bestTP?.exp}R · WR {bestTP?.wr}% · su {enriched.filter(function(t){return t.mfeR!=null;}).length} trade con MFE</div>
                  <div style={{fontSize:10,color:c.txm,background:c.bg,borderRadius:6,padding:"6px 8px",lineHeight:1.5}}>
                    Il TP che avrebbe massimizzato l'expectancy su questo campione. Basato sulla distribuzione MFE dei tuoi trade.
                  </div>
                </div>
                <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.gr+"40"}}>
                  <div style={{fontSize:10,fontWeight:700,color:c.gr,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>🛡 BE Ottimale (automatico)</div>
                  <div style={{fontSize:28,fontWeight:800,color:c.gr,marginBottom:4}}>{bestBE?.exp>0?bestBE.be+"R":"—"}</div>
                  <div style={{fontSize:11,color:c.txm,marginBottom:8}}>
                    {bestBE?.exp>0?"Exp "+bestBE.exp+"R · WR "+bestBE.wr+"% · DD -"+bestBE.dd+"R":"Nessun miglioramento con BE anticipato"}
                  </div>
                  <div style={{fontSize:10,color:c.txm,background:c.bg,borderRadius:6,padding:"6px 8px",lineHeight:1.5}}>
                    Il punto di breakeven che avrebbe ridotto il drawdown massimizzando comunque l'expectancy.
                  </div>
                </div>
              </div>

              {/* Tabella TP comparison */}
              <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,marginBottom:10}}>Confronto TP — tutti i livelli testati</div>
                <div style={{background:c.card,borderRadius:10,border:"1px solid "+c.bd,overflow:"hidden"}}>
                  <div style={{display:"grid",gridTemplateColumns:"80px 70px 70px 80px 1fr",padding:"7px 14px",background:c.tag,gap:0}}>
                    {["TP Target","Trade","Win%","Expectancy","Barra Exp"].map(function(h){return <div key={h} style={{fontSize:9,fontWeight:700,color:c.txm,textTransform:"uppercase",letterSpacing:"0.05em"}}>{h}</div>;})}
                  </div>
                  {tpResults.map(function(row){
                    const isBest=bestTP&&row.tp===bestTP.tp;
                    const maxExp=Math.max(...tpResults.map(function(r){return Math.abs(r.exp);}),0.01);
                    const barPct=Math.abs(row.exp)/maxExp*100;
                    return(
                      <div key={row.tp} style={{display:"grid",gridTemplateColumns:"80px 70px 70px 80px 1fr",padding:"8px 14px",borderTop:"1px solid "+c.bdl,gap:0,alignItems:"center",background:isBest?c.ac+"08":"transparent"}}>
                        <div style={{display:"flex",alignItems:"center",gap:4}}>
                          <span style={{fontSize:12,fontWeight:700}}>{row.tp}R</span>
                          {isBest&&<span style={{fontSize:8,fontWeight:700,color:c.ac,background:c.ac+"15",padding:"1px 5px",borderRadius:4}}>BEST</span>}
                        </div>
                        <div style={{fontSize:11}}>{row.n}</div>
                        <div style={{fontSize:11,fontWeight:700,color:row.wr>=50?c.gr:c.rd}}>{row.wr}%</div>
                        <div style={{fontSize:12,fontWeight:700,color:row.exp>=0?c.gr:c.rd}}>{row.exp>=0?"+":""}{row.exp}R</div>
                        <div style={{height:14,background:c.bdl,borderRadius:3,overflow:"hidden"}}>
                          <div style={{width:barPct+"%",height:"100%",background:row.exp>=0?c.gr:c.rd,borderRadius:3,opacity:0.7}}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Simulatore manuale */}
              <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,marginBottom:4}}>🔬 Simulatore What-If — Configurazione Manuale</div>
                <div style={{fontSize:9,color:c.txm,marginBottom:14}}>Imposta la tua strategia di gestione e vedi cosa sarebbe successo su questo campione</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
                  {[
                    {l:"TP Target (R)",v:simTpR,set:setSimTpR,min:0.5,max:10,step:0.25},
                    {l:"BE a (R) — 0=disattivo",v:simBeR,set:setSimBeR,min:0,max:3,step:0.25},
                    {l:"Parziale % a chiudere",v:simParz1Pct,set:setSimParz1Pct,min:0,max:100,step:10},
                    {l:"Parziale al livello (R)",v:simParz1R,set:setSimParz1R,min:0,max:5,step:0.25},
                  ].map(function(f){return(
                    <div key={f.l}>
                      <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>{f.l}</div>
                      <input type="range" min={f.min} max={f.max} step={f.step} value={f.v}
                        onChange={function(e){f.set(parseFloat(e.target.value));}}
                        style={{width:"100%",accentColor:c.ac,cursor:"pointer"}}/>
                      <div style={{fontSize:12,fontWeight:700,color:c.ac,textAlign:"center",marginTop:2}}>
                        {f.v===0?"OFF":f.v+(f.l.includes("%")?"":f.l.includes("%")?"":"")}
                        {f.l.includes("(R)")?" R":f.l.includes("%")?" %":""}
                      </div>
                    </div>
                  );})}
                </div>
                {/* Risultati simulazione */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:14}}>
                  {[
                    {l:"Exp simulata",v:(simExp>=0?"+":"")+simExp+"R",col:simExp>=0?c.gr:c.rd,tt:"L'expectancy simulata: il guadagno medio atteso per ogni trade con questa configurazione. Confrontala con la tua expectancy reale — se è più alta, questa gestione sarebbe più profittevole nel lungo periodo."},
                    {l:"Win Rate sim",v:simWR+"%",col:simWR>=50?c.gr:c.rd,tt:"Il win rate che avresti ottenuto con questo scenario simulato. Cambiare il TP influenza quanti trade raggiungono l'obiettivo — un TP più basso aumenta il WR ma riduce il guadagno per trade."},
                    {l:"Total R sim",v:(simTotalR>=0?"+":"")+simTotalR+"R",col:simTotalR>=0?c.gr:c.rd,tt:"Il risultato totale in R che avresti ottenuto con questa configurazione simulata su tutti i trade del campione. Confrontalo con il tuo totale reale per vedere se questa gestione sarebbe stata più o meno profittevole."},
                    {l:"Max DD sim",v:"-"+simDD.toFixed(2)+"R",col:c.rd,tt:"Il drawdown massimo simulato — la perdita più profonda dal picco con questa configurazione. Un TP più basso spesso riduce il drawdown perché le uscite sono più frequenti. Confrontalo con il drawdown reale per valutare se questa gestione è più stabile."},
                    {l:"Differenza exp",v:(simExp-metGlobali.exp>=0?"+":"")+(simExp-metGlobali.exp).toFixed(2)+"R",col:simExp>=metGlobali.exp?c.gr:c.rd,tt:"La differenza tra l'expectancy simulata e quella reale. Positivo = la configurazione simulata avrebbe prodotto più R per trade rispetto a come hai operato realmente. Negativo = la tua gestione attuale era migliore."},
                  ].map(function(m,i){return(
                    <div key={i} style={{background:c.bg,borderRadius:8,padding:"9px 10px",border:"1px solid "+c.bd,textAlign:"center"}}>
                      <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:2,display:"flex",alignItems:"center",justifyContent:"center",gap:2}}>{m.l}{m.tt&&<Tooltip c={c} text={m.tt} pos="top"/>}</div>
                      <div style={{fontSize:13,fontWeight:800,color:m.col}}>{m.v}</div>
                    </div>
                  );})}
                </div>
                {/* Dual equity curve */}
                {dualEq.length>2&&(function(){
                  const h=90;const w_=dualEq.length;
                  const minV=Math.min(...dualEq.map(function(p){return Math.min(p.orig,p.man);}));
                  const maxV=Math.max(...dualEq.map(function(p){return Math.max(p.orig,p.man);}));
                  const range=Math.max(maxV-minV,0.01);
                  function toY(v){return h-(((v-minV)/range)*(h-10)+5);}
                  function buildPath(key){
                    return dualEq.map(function(p,i){
                      const x=(i/(dualEq.length-1))*100;
                      const y=toY(p[key]);
                      return (i===0?"M":"L")+x.toFixed(1)+","+y.toFixed(1);
                    }).join(" ");
                  }
                  return(
                    <div>
                      <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:6,textTransform:"uppercase"}}>Equity curve: Originale vs Simulata</div>
                      <svg viewBox={"0 0 100 "+h} style={{width:"100%",height:h,display:"block"}}>
                        <line x1="0" y1={toY(0).toFixed(1)} x2="100" y2={toY(0).toFixed(1)} stroke={c.bd} strokeWidth="0.5" strokeDasharray="2,2"/>
                        <path d={buildPath("orig")} fill="none" stroke={c.txm} strokeWidth="1.5" opacity="0.6"/>
                        <path d={buildPath("man")} fill="none" stroke={c.ac} strokeWidth="2"/>
                      </svg>
                      <div style={{display:"flex",gap:16,marginTop:4}}>
                        <div style={{display:"flex",alignItems:"center",gap:4,fontSize:9,color:c.txm}}><div style={{width:16,height:2,background:c.txm,opacity:0.6}}/> Originale ({metGlobali.totalR>=0?"+":""}{metGlobali.totalR}R)</div>
                        <div style={{display:"flex",alignItems:"center",gap:4,fontSize:9,color:c.ac}}><div style={{width:16,height:2,background:c.ac}}/> Simulata ({simTotalR>=0?"+":""}{simTotalR}R)</div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </>
          );
        })()}
      </div>

      {/* MODALE NUOVO TRADE */}
      {showNuovoTrade&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:c.card,borderRadius:14,padding:24,width:500,maxHeight:"85vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:16}}>{editingTrade?"✏️ Modifica Trade Backtest":"Aggiungi Trade Backtest"}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              <div>
                <DatePicker label="DATA/ORA APERTURA" value={tForm.data} onChange={function(v){setTForm(function(p){return {...p,data:v,data_chiusura:p.data_chiusura||v};});}} c={c}/>
              </div>
              <div>
                <DatePicker label="DATA/ORA CHIUSURA *" value={tForm.data_chiusura||tForm.data} onChange={function(v){setTForm(function(p){return {...p,data_chiusura:v};});}} c={c}/>
                <div style={{fontSize:9,color:c.am,marginTop:3}}>Obbligatorio per il calcolo affidabilità Bot</div>
              </div>
              {[{l:"Risultato R *",k:"r_result",type:"number",ph:"es. +2 / -1 / 0"},{l:"MFE in R (opz.)",k:"mfe",type:"number",ph:"es. 3.2"}].map(function(f){return(
                <div key={f.k}>
                  <div style={{fontSize:10,fontWeight:600,marginBottom:3}}>{f.l}</div>
                  <input type={f.type||"text"} value={tForm[f.k]||""} onChange={function(e){setTForm(function(p){return {...p,[f.k]:e.target.value};});}} placeholder={f.ph||""} style={{width:"100%",padding:"7px 9px",borderRadius:7,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                </div>
              );})}
            </div>
            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:600,marginBottom:5}}>Direzione</div>
              <div style={{display:"flex",gap:6}}>
                {[{v:"L",l:"▲ Long"},{v:"S",l:"▼ Short"}].map(function(d){const a=tForm.direzione===d.v;return(
                  <button key={d.v} onClick={function(){setTForm(function(p){return {...p,direzione:d.v};});}} style={{padding:"6px 16px",borderRadius:7,border:"1px solid "+(a?c.gr:c.bd),background:a?c.gr+"15":"transparent",color:a?c.gr:c.txm,fontSize:11,fontWeight:a?700:400,cursor:"pointer",fontFamily:"inherit"}}>{d.l}</button>
                );})}
              </div>
            </div>
            {allParams.length>0&&(
              <div style={{marginBottom:12}}>
                <div style={{fontSize:10,fontWeight:600,marginBottom:6}}>Parametri presenti in questo trade</div>
                {["direzionalita","trigger","confluenze_pro","confluenze_contro","extra"].map(function(fam){
                  const items=progettoCorrente?.parametri?.[fam]||[];
                  if(items.length===0) return null;
                  return(
                    <div key={fam} style={{marginBottom:8}}>
                      <div style={{fontSize:9,fontWeight:700,color:famColors[fam],marginBottom:4}}>{famLabels[fam]}</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                        {items.map(function(item){const sel=(tForm.params||[]).includes(item);return(
                          <button key={item} onClick={function(){setTForm(function(p){const ps=p.params||[];return {...p,params:sel?ps.filter(function(x){return x!==item;}):[...ps,item]};});}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(sel?famColors[fam]:c.bd),background:sel?famColors[fam]+"15":"transparent",color:sel?famColors[fam]:c.txm,fontSize:10,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{item}</button>
                        );})}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Confidence */}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:600,marginBottom:6}}>Confidence nel Setup</div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                {[1,2,3,4,5].map(function(n){
                  const filled=n<=(tForm.confidence||0);
                  return(
                    <button key={n} onClick={function(){setTForm(function(p){return {...p,confidence:p.confidence===n?0:n};});}}
                      style={{fontSize:20,background:"none",border:"none",cursor:"pointer",padding:2,lineHeight:1,opacity:filled?1:0.25,transition:"all 0.1s"}}>
                      ⭐
                    </button>
                  );
                })}
                {(tForm.confidence||0)>0&&<span style={{fontSize:10,color:c.ac,fontWeight:600,marginLeft:4}}>{tForm.confidence}/5</span>}
                {(tForm.confidence||0)===0&&<span style={{fontSize:10,color:c.txm,marginLeft:4}}>Clicca per valutare</span>}
              </div>
            </div>
            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:600,marginBottom:3}}>Note</div>
              <textarea value={tForm.note||""} onChange={function(e){setTForm(function(p){return {...p,note:e.target.value};});}} placeholder="Osservazioni sul trade, contesto di mercato, motivazione..." style={{width:"100%",padding:"7px 9px",borderRadius:7,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",resize:"vertical",minHeight:60,boxSizing:"border-box"}}/>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={function(){setShowNuovoTrade(false);setEditingTrade(null);setTForm(initTForm(lastBtDate));}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
              <button onClick={salvaTrade} style={{padding:"8px 20px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{editingTrade?"💾 Aggiorna":"Salva Trade"}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE IMPORT LIVE */}
      {showImport&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:c.card,borderRadius:14,padding:24,width:380,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:8}}>Importa Trade Live</div>
            <div style={{fontSize:12,color:c.txm,marginBottom:20,lineHeight:1.6}}>
              Importa {trades.filter(function(t){return !t.draft&&t.entry&&t.sl&&t.exit;}).length} trade live (con entry/SL/exit) in questo progetto backtest. I duplicati vengono ignorati automaticamente.<br/><br/>
              <strong style={{color:c.am}}>Nota:</strong> dopo l'importazione potrai assegnare i parametri a ciascun trade nel tab Trade.
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={function(){setShowImport(false);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
              <button onClick={importaLive} style={{padding:"8px 20px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Importa</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── APP ROOT ──────────────────────────────────────────────────────────────────
export default function App(){
  const [dark,setDark]=useState(false);
  const [active,setActive]=useState("dashboard");
  const [screen,setScreen]=useState("dashboard");
  const [strategie,setStrategie]=useState([]);
  const [conti,setConti]=useState([]);
  const [trades,setTrades]=useState([]);
  const [btProjects,setBtProjects]=useState([]);
  const [btTrades,setBtTrades]=useState([]);
  const [loading,setLoading]=useState(true);
  const c=dark?D:L;

  const reload=useCallback(async function(){
    const [s,cn,t,bp,bt]=await Promise.all([
      db.strategie.toArray(),db.conti.toArray(),db.trade.toArray(),
      db.bt_progetti.toArray(),db.bt_trade.toArray()
    ]);
    setStrategie(s);setConti(cn);setTrades(t);setBtProjects(bp);setBtTrades(bt);
  },[]);

  useEffect(function(){
    reload().then(function(){setLoading(false);});
  },[reload]);

  function renderScreen(){
    if(loading) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:c.txm,fontSize:14}}>Caricamento...</div>;
    if(screen==="form") return <TradeForm c={c} strategie={strategie} conti={conti} reload={reload} setScreen={setScreen}/>;
    if(screen==="strategie") return <Strategie c={c} strategie={strategie} reload={reload}/>;
    if(screen==="conti") return <Conti c={c} conti={conti} strategie={strategie} trades={trades} reload={reload}/>;
    if(screen==="journal") return <Journal c={c} trades={trades} strategie={strategie} conti={conti} reload={reload}/>;
    if(screen==="analytics") return <Analytics c={c} trades={trades} strategie={strategie} conti={conti}/>;
    if(screen==="ottimizzazione") return <Ottimizzazione c={c} trades={trades} strategie={strategie} conti={conti}/>;
    if(screen==="sim-gestione") return <SimGestione c={c} trades={trades} strategie={strategie} conti={conti}/>;
    if(screen==="sim-cap") return <SimCapitale c={c} trades={trades} strategie={strategie} conti={conti}/>;
    if(screen==="monte-carlo") return <MonteCarlo c={c} trades={trades} strategie={strategie} conti={conti}/>;
    if(screen==="backtest") return <Backtest c={c} trades={trades} btProjects={btProjects} btTrades={btTrades} reload={reload}/>;
    if(screen==="coach") return <Coach c={c} trades={trades} strategie={strategie} conti={conti} btProjects={btProjects} btTrades={btTrades}/>;
    if(screen==="report") return <Report c={c} trades={trades} strategie={strategie} conti={conti}/>;
    if(screen==="impostazioni") return <Impostazioni c={c} dark={dark} setDark={setDark} reload={reload} conti={conti} strategie={strategie}/>;
    return <Dashboard c={c} setScreen={setScreen} trades={trades} strategie={strategie} conti={conti}/>;
  }

  return (
    <div style={{display:"flex",height:"100vh",width:"100vw",background:c.bg,fontFamily:"system-ui,sans-serif",color:c.tx,overflow:"hidden",fontSize:14}}>
      <Sidebar active={active} setActive={setActive} setScreen={setScreen} dark={dark} setDark={setDark} c={c} trades={trades} strategie={strategie} conti={conti}/>
      <div style={{flex:1,overflow:"hidden",display:"flex"}}>{renderScreen()}</div>
    </div>
  );
}
