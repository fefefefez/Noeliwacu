import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import CreateParty from './pages/CreateParty';
import JoinParty from './pages/JoinParty';
import AdminDashboard from './pages/AdminDashboard';
import DrawPage from './pages/DrawPage';
import Snowflakes from './components/Snowflakes';
import Footer from './components/Footer';
import './App.css';

function App() {
    return (
        <BrowserRouter>
            <Snowflakes />
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/create-party" element={<CreateParty />} />
                <Route path="/join/:code?" element={<JoinParty />} />
                <Route path="/admin/:code" element={<AdminDashboard />} />
                <Route path="/draw/:code" element={<DrawPage />} />
            </Routes>
            <Footer />
        </BrowserRouter>
    );
}

export default App;