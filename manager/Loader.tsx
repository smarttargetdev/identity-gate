/**
 * File: Loader.tsx
 * Kind: TypeScript React
 * Container: /manager
 * Summary: Bootstrap React DOM responsável por montar o componente principal Application e estilos globais.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-24
 * Developer: Osvandir Júnior
 */

import {createRoot} from 'react-dom/client';
import Application from './Application.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<Application />);
