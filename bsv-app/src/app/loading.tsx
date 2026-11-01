import { LoaderCircle } from 'lucide-react';

export default function Loading() {
  return <main className="loading-screen"><span className="brand-mark">BSV</span><h1>BSV Weitnau</h1><p role="status"><LoaderCircle className="spin" size={19} />Daten werden geladen</p></main>;
}