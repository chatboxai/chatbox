import { createRoot } from 'react-dom/client';
import App from './devtools/App';

function render() {
    const rootElement = document.getElementById('root');
    if (!rootElement) {
        throw new Error('Root element not found');
    }
    const root = createRoot(rootElement);
    root.render(<App />);
}

render();
