import React, { useEffect, useState } from 'react';
import { FlowConnection } from '@carbon/icons-react';

export function WindowTitlebar() {
  const [title, setTitle] = useState(document.title);
  useEffect(() => {
    const observer = new MutationObserver(() => setTitle(document.title));
    observer.observe(document.querySelector('title'), { childList: true });
    return () => observer.disconnect();
  }, []);
  return <div className="window-titlebar" aria-label="窗口标题栏">
    <div className="window-titlebar-content"><FlowConnection size={16}/><span>{title}</span></div>
  </div>;
}
