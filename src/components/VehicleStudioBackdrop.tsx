/** Decorative illustration only; this is not a generated part or model. */
export default function VehicleStudioBackdrop() {
  return <div className="vehicle-brick-art" aria-hidden="true">
    <svg viewBox="0 0 440 280" fill="none" focusable="false">
      <defs>
        <linearGradient id="studio-brick-yellow" x1="156" y1="80" x2="315" y2="172" gradientUnits="userSpaceOnUse"><stop stopColor="#ffe478"/><stop offset="1" stopColor="#ffcc39"/></linearGradient>
        <linearGradient id="studio-brick-blue" x1="143" y1="19" x2="250" y2="99" gradientUnits="userSpaceOnUse"><stop stopColor="#79a6df"/><stop offset="1" stopColor="#4a7cc6"/></linearGradient>
        <filter id="studio-brick-shadow" x="-40%" y="-40%" width="180%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
      </defs>
      <path d="M34 210 213 269 410 191" stroke="#c8d4df" strokeDasharray="3 7"/>
      <path d="M58 153 238 213 407 145M103 234 103 112M377 219V99" stroke="#d9e1e5" strokeDasharray="3 7"/>
      <ellipse cx="246" cy="227" rx="123" ry="15" fill="#384b67" opacity=".13" filter="url(#studio-brick-shadow)"/>
      <g>
        <path d="m132 66 66-27 68 30-66 29z" fill="url(#studio-brick-blue)"/>
        <path d="m132 66 68 32v28l-68-32z" fill="#4776b7"/>
        <path d="m200 98 66-29v28l-66 29z" fill="#315b97"/>
        {[{x:165,y:64},{x:198,y:51},{x:199,y:80},{x:232,y:66}].map(({x,y})=><g key={x+":"+y}><ellipse cx={x} cy={y} rx="12" ry="6" fill="#3c6cae"/><path d={`M${x-12} ${y}v-6a12 6 0 0 1 24 0v6`} fill="#6291d0"/><ellipse cx={x} cy={y-6} rx="12" ry="6" fill="#91b6e7"/><path d={`M${x-8} ${y-9}q8-4 16 0`} stroke="#c2d7f3" strokeLinecap="round"/></g>)}
      </g>
      <g>
        <path d="m79 170 67-25 67 29-67 28z" fill="#ef7870"/>
        <path d="m79 170 67 32v25l-67-32z" fill="#d65350"/>
        <path d="m146 202 67-28v26l-67 27z" fill="#b94142"/>
        {[{x:112,y:169},{x:145,y:156},{x:146,y:184},{x:179,y:170}].map(({x,y})=><g key={x+":"+y}><ellipse cx={x} cy={y} rx="12" ry="6" fill="#c54e4c"/><path d={`M${x-12} ${y}v-6a12 6 0 0 1 24 0v6`} fill="#e96560"/><ellipse cx={x} cy={y-6} rx="12" ry="6" fill="#ff9790"/><path d={`M${x-8} ${y-9}q8-4 16 0`} stroke="#ffc3bd" strokeLinecap="round"/></g>)}
      </g>
      <g>
        <path d="m166 139 132-50 92 43-132 53z" fill="url(#studio-brick-yellow)"/>
        <path d="m166 139 92 46v33l-92-46z" fill="#eeb336"/>
        <path d="m258 185 132-53v33l-132 53z" fill="#dca025"/>
        {[{x:204,y:139},{x:248,y:122},{x:292,y:105},{x:250,y:160},{x:294,y:143},{x:338,y:126}].map(({x,y})=><g key={x+":"+y}><ellipse cx={x} cy={y} rx="14" ry="7" fill="#d8a12e"/><path d={`M${x-14} ${y}v-7a14 7 0 0 1 28 0v7`} fill="#efba39"/><ellipse cx={x} cy={y-7} rx="14" ry="7" fill="#ffe994"/><path d={`M${x-9} ${y-11}q9-4 18 0`} stroke="#fff7cd" strokeWidth="1.5" strokeLinecap="round"/></g>)}
        <path d="m167 139 91 45 131-52" stroke="#ffed9d" strokeLinecap="round"/>
      </g>
      <g stroke="#8b9dae" strokeLinecap="round"><path d="M374 51v10m-5-5h10M73 98v8m-4-4h8"/><circle cx="336" cy="53" r="3"/><circle cx="63" cy="217" r="2"/></g>
    </svg>
  </div>;
}
