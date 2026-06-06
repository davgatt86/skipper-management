:root {
  --navy: #1F3864;
  --navy-light: #2E75B6;
  --green: #70AD47;
  --amber: #FFC000;
  --red: #C00000;
  --grey-50: #FAFAFA;
  --grey-100: #F2F2F2;
  --grey-200: #D9D9D9;
  --grey-400: #808080;
  --grey-700: #404040;
  --bg: #ffffff;
  --text: #1a1a1a;
  --border: #d0d7de;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg);
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--navy-light); text-decoration: none; }
a:hover { text-decoration: underline; }

button {
  font: inherit;
  cursor: pointer;
  background: var(--navy);
  color: white;
  border: none;
  padding: 0.6rem 1.2rem;
  border-radius: 6px;
  font-weight: 600;
  transition: opacity 0.15s;
}
button:hover { opacity: 0.9; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.secondary {
  background: white;
  color: var(--navy);
  border: 1px solid var(--border);
}

input, select, textarea {
  font: inherit;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: white;
  width: 100%;
}
input:focus, select:focus, textarea:focus {
  outline: 2px solid var(--navy-light);
  outline-offset: -1px;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem;
}

@media (min-width: 768px) {
  .container { padding: 2rem; }
}

.card {
  background: white;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 1rem;
}

h1 { font-size: 1.75rem; color: var(--navy); margin-bottom: 1rem; }
h2 { font-size: 1.25rem; color: var(--navy); margin-bottom: 0.75rem; }

.muted { color: var(--grey-400); font-size: 0.9rem; }
.error { color: var(--red); margin: 0.5rem 0; }
.success { color: var(--green); margin: 0.5rem 0; }


/* ---- Fish Sales print / save-as-PDF ---- */
@media print {
  .no-print { display: none !important; }
  .print-only { display: block !important; }
  body { background: white; }
  .container { max-width: none; padding: 0; }
  .card { border: none; padding: 0.5rem 0; margin-bottom: 0.75rem; break-inside: avoid; }
  #sales-report h2.print-only { display: block !important; font-size: 1.4rem; margin-bottom: 1rem; }
  #sales-report table { font-size: 0.8rem; }
  #sales-report .recharts-responsive-container { break-inside: avoid; }
}
