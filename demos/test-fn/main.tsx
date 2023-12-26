import React, { useState, useRef } from 'react';
import ReactDOM from 'react-dom/client';

function App() {
  const divRef = useRef(null);
  const [count, setCount] = useState(0);

  setTimeout(() => {
    const divDOM = divRef.current;
    if (divDOM) {
      (divDOM as Element).addEventListener('click', () => {
        const num = Math.random();
        console.log(num);
        setCount(num);
      });
    }
  });
  return <div ref={divRef}>{count}</div>;
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);
