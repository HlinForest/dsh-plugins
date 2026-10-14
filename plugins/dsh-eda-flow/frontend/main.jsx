import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { WindowTitlebar } from './WindowTitlebar.jsx';
import './styles.css';
const desktop = window.edaDesktop?.titlebarHeight === 40;
if (desktop) document.documentElement.classList.add('desktop-window');
createRoot(document.getElementById('root')).render(<>{desktop && <WindowTitlebar/>}<App/></>);
