import React from 'react';
import ReactDOM from 'react-dom/client';
import { OwnerApp } from './OwnerApp';
import '../index.css';
import '../App.css';
import './mobile.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OwnerApp />
  </React.StrictMode>
);
