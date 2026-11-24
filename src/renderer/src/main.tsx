import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Falta el elemento #root');

// Sin StrictMode: su doble montaje en desarrollo intentaría transferir el canvas al worker
// dos veces, y un canvas solo se puede transferir una.
createRoot(root).render(<App />);
