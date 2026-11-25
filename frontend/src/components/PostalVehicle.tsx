export function PostalVehicle({ kind }: { kind: 'truck' | 'airplane' }) {
  return <svg className="homie-post-vehicle" data-vehicle={kind} viewBox="0 0 100 54" aria-hidden="true" focusable="false" stroke="#233f49" strokeWidth="2" strokeLinejoin="round">
    {kind === 'truck' ? <>
      <path fill="#56858a" d="M4 12Q4 9 8 9H47V40H4Z" />
      <path fill="#f9db99" d="M47 35H69V18H78L89 30V40H47Z" />
      <path fill="#c4ebea" d="M73 20H77L84 29H73Z" />
      <path fill="#f3eee1" d="M4 34H47V40H4Z" />
      <g fill="#35484f"><circle cx="21" cy="41" r="7"/><circle cx="76" cy="41" r="7"/></g>
      <g fill="#e6e0c9"><circle cx="21" cy="41" r="3"/><circle cx="76" cy="41" r="3"/></g>
    </> : <>
      <path fill="#d47d57" d="M6 31L3 12H11L24 28Z"/>
      <path fill="#e9b55e" d="M4 27L47 28Q56 38 68 26L89 25Q96 30 87 35Q46 46 4 31Z"/>
      <path fill="#679a9c" d="M59 32L43 47H29L46 32Z"/>
      <path d="M91 16V42" strokeWidth="4" strokeLinecap="round"/>
    </>}
    <g transform={kind === 'truck' ? 'translate(16 17)' : 'translate(15 26) scale(.65)'} fill="#fff8e4">
      <rect width="20" height="13" rx="2"/><path d="m1 1 9 7 9-7" fill="none"/>
    </g>
  </svg>
}
