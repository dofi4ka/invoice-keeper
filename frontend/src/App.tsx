import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import Nav from "./components/Nav";
import Audit from "./pages/Audit";
import Budget from "./pages/Budget";
import CalendarPage from "./pages/Calendar";
import Categories from "./pages/Categories";
import Dashboard from "./pages/Dashboard";
import Invoices from "./pages/Invoices";
import Login from "./pages/Login";
import Users from "./pages/Users";
import Webhooks from "./pages/Webhooks";

function Layout() {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return (
    <div className="app">
      <Nav />
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

function AdminOnly() {
  const { user } = useAuth();
  return user?.is_admin ? <Outlet /> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="budget" element={<Budget />} />
        <Route element={<AdminOnly />}>
          <Route path="categories" element={<Categories />} />
          <Route path="webhooks" element={<Webhooks />} />
          <Route path="team" element={<Users />} />
          <Route path="audit" element={<Audit />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
