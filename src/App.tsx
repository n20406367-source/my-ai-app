import React, { createContext, useContext, useState, useEffect } from 'react';
import { 
  BrowserRouter as Router, 
  Routes, 
  Route, 
  Navigate, 
  useNavigate 
} from 'react-router-dom';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  updateDoc, 
  doc, 
  deleteDoc,
  onSnapshot,
  orderBy,
  limit,
  serverTimestamp,
  getDoc
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import { db, auth } from './lib/firebase';
import { 
  LayoutDashboard, 
  Users, 
  CreditCard, 
  History, 
  LogOut, 
  Plus, 
  CheckCircle, 
  XCircle, 
  Clock,
  MessageCircle,
  DollarSign,
  Home,
  User,
  Wifi,
  Trash2,
  Zap,
  Lock,
  ExternalLink,
  Bell,
  Settings,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  Info,
  Pencil,
  ChefHat,
  Utensils,
  Coffee,
  Lightbulb,
  Calendar,
  Filter,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

// --- Types ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

interface Member {
  id: string;
  name: string;
  phone: string;
  email?: string;
  password?: string;
  role: 'admin' | 'member';
  fanCount?: number;
  isGuardian?: boolean;
}

interface Billing {
  id: string;
  category: string;
  totalAmount: number;
  perMemberAmount?: number;
  month: string;
  year: string;
  billingType: 'Standard' | 'Current Bill';
  selectedMemberIds: string[];
  calculationDetails?: {
    basePortion: number;
    fanPortion: number;
    totalFans: number;
  };
}

interface Payment {
  id: string;
  memberId: string;
  memberName: string;
  category: string;
  amount: number;
  method: 'Cash' | 'Bkash' | 'Nagad';
  transactionIdOrTime: string;
  status: 'pending' | 'approved' | 'rejected';
  month: string;
  year: string;
  timestamp: any;
}

interface LoanRequest {
  id: string;
  memberId: string;
  memberName: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  timestamp: any;
}

interface Notice {
  id: string;
  title: string;
  content: string;
  timestamp: any;
}

interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'bill' | 'notice' | 'reminder';
  read: boolean;
  timestamp: any;
}

const BILLING_CATEGORIES = [
  'House Rent',
  'Chef',
  'Internet',
  'Waste',
  'Electricity',
  'Meal',
  'Others'
];

const sendEmailNotification = async (to: string, subject: string, message: string) => {
  try {
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to,
        subject,
        text: message,
        html: `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #00bcd4;">Mess & T.U.T. Manager</h2>
          <p>${message}</p>
          <hr style="border: 0; border-top: 1px solid #eee;" />
          <p style="font-size: 12px; color: #666;">This is an automated notification. Please do not reply.</p>
        </div>`
      }),
    });
    return await response.json();
  } catch (error) {
    console.error('Failed to send email:', error);
    return { error: 'Failed to send email' };
  }
};

// --- Auth Context ---
interface AuthContextType {
  user: Member | null;
  login: (phone: string, password: string, pin?: string) => Promise<boolean>;
  loginWithGoogle: () => Promise<boolean>;
  logout: () => void;
  loading: boolean;
  notifications: Notification[];
  markAsRead: (id: string) => Promise<void>;
  unreadCount: number;
  testNotification: () => void;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (enabled: boolean) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(() => {
    const saved = localStorage.getItem('notifications_enabled');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const isInitialLoad = React.useRef(true);

  const setNotificationsEnabled = (enabled: boolean) => {
    setNotificationsEnabledState(enabled);
    localStorage.setItem('notifications_enabled', JSON.stringify(enabled));
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      console.log('Firebase Auth State Changed:', firebaseUser?.uid, firebaseUser?.email, 'Anonymous:', firebaseUser?.isAnonymous);
      
      const savedUser = localStorage.getItem('mess_user');
      if (savedUser) {
        const parsedUser = JSON.parse(savedUser);
        // If it's an admin logged in with Google, verify email
        if (parsedUser.role === 'admin' && firebaseUser?.email === 'tahsinullahtusher999@gmail.com') {
          setUser(parsedUser);
        } else if (parsedUser.role === 'member') {
          setUser(parsedUser);
        } else {
          // Inconsistent state, clear it
          localStorage.removeItem('mess_user');
          setUser(null);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Sync user data with Firestore
  useEffect(() => {
    if (!user || user.role !== 'member') return;

    const unsub = onSnapshot(doc(db, 'members', user.id), (docSnap) => {
      if (docSnap.exists()) {
        const updatedUser = { id: docSnap.id, ...docSnap.data(), role: 'member' } as Member;
        setUser(updatedUser);
        localStorage.setItem('mess_user', JSON.stringify(updatedUser));
      }
    });

    return () => unsub();
  }, [user?.id, user?.role]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const showDeviceNotification = async (title: string, options: NotificationOptions) => {
    console.log('Attempting to show notification:', title, options);
    if (!notificationsEnabled) {
      console.log('Notifications are disabled in app settings.');
      return;
    }
    if (typeof window === 'undefined' || !('Notification' in window)) {
      console.log('Notification API not supported.');
      return;
    }
    
    if (Notification.permission === 'granted') {
      try {
        if ('serviceWorker' in navigator) {
          console.log('Using Service Worker for notification...');
          const registration = await navigator.serviceWorker.ready;
          await registration.showNotification(title, {
            ...options,
            icon: options.icon || 'https://cdn-icons-png.flaticon.com/512/3119/3119338.png',
            badge: 'https://cdn-icons-png.flaticon.com/512/3119/3119338.png',
          });
          console.log('Notification shown via Service Worker.');
        } else {
          console.log('Using new Notification() fallback...');
          new Notification(title, options);
        }
      } catch (e) {
        console.error('Service worker notification failed, falling back to new Notification():', e);
        try {
          new Notification(title, options);
        } catch (err) {
          console.error('Fallback notification also failed:', err);
        }
      }
    } else {
      console.log('Notification permission status:', Notification.permission);
    }
  };

  useEffect(() => {
    console.log('AuthProvider notification effect running for user:', user?.id);
    if (!user) {
      setNotifications([]);
      return;
    }

    let unsub: () => void;

    if (user.role === 'member') {
      const q = query(
        collection(db, 'notifications'), 
        where('userId', '==', user.id), 
        orderBy('timestamp', 'desc')
      );

      unsub = onSnapshot(q, (snapshot) => {
        console.log('Notification snapshot received, count:', snapshot.size);
        const newNotifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Notification));
        
        if (!isInitialLoad.current) {
          console.log('Not initial load, checking for member notification changes...');
          snapshot.docChanges().forEach((change) => {
            console.log('Member change type:', change.type);
            if (change.type === 'added') {
              const data = change.doc.data() as Notification;
              console.log('New notification added:', data);
              if (!data.read) {
                showDeviceNotification(data.title, {
                  body: data.message,
                });
              }
            }
          });
        }
        setNotifications(newNotifications);
        isInitialLoad.current = false;
      }, (err) => handleFirestoreError(err, OperationType.LIST, 'notifications'));
    } else {
      // Admin Notifications for pending items
      const unsubPayments = onSnapshot(query(collection(db, 'payments'), where('status', '==', 'pending')), (snapshot) => {
        if (!isInitialLoad.current) {
          console.log('Not initial load, checking for admin payment changes...');
          snapshot.docChanges().forEach((change) => {
            console.log('Admin payment change type:', change.type);
            if (change.type === 'added') {
              showDeviceNotification('New Payment Request', {
                body: 'A member has submitted a new payment for approval.',
              });
            }
          });
        }
      });

      const unsubLoans = onSnapshot(query(collection(db, 'loans'), where('status', '==', 'pending')), (snapshot) => {
        if (!isInitialLoad.current) {
          console.log('Not initial load, checking for admin loan changes...');
          snapshot.docChanges().forEach((change) => {
            console.log('Admin loan change type:', change.type);
            if (change.type === 'added') {
              showDeviceNotification('New Loan Request', {
                body: 'A member has requested a new loan.',
              });
            }
          });
        }
      });

      unsub = () => {
        unsubPayments();
        unsubLoans();
      };
      isInitialLoad.current = false;
    }

    return () => unsub();
  }, [user, notificationsEnabled]);

  const markAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `notifications/${id}`);
    }
  };

  const testNotification = async () => {
    console.log('Testing notification...');
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        try {
          await showDeviceNotification('Test Notification', {
            body: 'This is a test notification from Mess & T.U.T. Manager.',
          });
          console.log('Test notification sent successfully.');
        } catch (err) {
          console.error('Failed to send test notification:', err);
          alert('Failed to send notification. Try opening the app in a new tab.');
        }
      } else {
        alert('Notification permission not granted. Current status: ' + Notification.permission);
      }
    } else {
      alert('This browser does not support desktop notifications.');
    }
  };

  const login = async (phone: string, password: string, pin?: string) => {
    // Admin Check
    if (phone === '01713710607' && password === 'MESS2026' && pin === '1234') {
      const admin: Member = { id: 'admin', name: 'Admin', phone, role: 'admin' };
      setUser(admin);
      localStorage.setItem('mess_user', JSON.stringify(admin));
      isInitialLoad.current = true; // Reset for new login
      return true;
    }

    // Member Check
    const q = query(collection(db, 'members'), where('phone', '==', phone), where('password', '==', password));
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      const docData = querySnapshot.docs[0].data();
      const member: Member = { 
        id: querySnapshot.docs[0].id, 
        ...docData,
        role: 'member' 
      } as Member;
      setUser(member);
      localStorage.setItem('mess_user', JSON.stringify(member));
      isInitialLoad.current = true; // Reset for new login
      return true;
    }

    return false;
  };

  const loginWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      if (result.user.email === 'tahsinullahtusher999@gmail.com') {
        const admin: Member = { 
          id: result.user.uid, 
          name: result.user.displayName || 'Admin', 
          phone: '01713710607', 
          role: 'admin' 
        };
        setUser(admin);
        localStorage.setItem('mess_user', JSON.stringify(admin));
        isInitialLoad.current = true;
        return true;
      } else {
        await signOut(auth);
        alert('Unauthorized email address.');
        return false;
      }
    } catch (err) {
      console.error('Google login failed:', err);
      return false;
    }
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
    localStorage.removeItem('mess_user');
    setNotifications([]);
    isInitialLoad.current = true;
  };

  return (
    <AuthContext.Provider value={{ 
      user, login, loginWithGoogle, logout, loading, notifications, markAsRead, unreadCount, testNotification,
      notificationsEnabled, setNotificationsEnabled 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

// --- Components ---

const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost', size?: 'default' | 'icon' }>(
  ({ className, variant = 'primary', size = 'default', ...props }, ref) => {
    const variants = {
      primary: 'bg-cyan-500 hover:bg-cyan-600 text-white',
      secondary: 'bg-slate-700 hover:bg-slate-600 text-white',
      danger: 'bg-red-500 hover:bg-red-600 text-white',
      ghost: 'bg-transparent hover:bg-slate-800 text-slate-300'
    };
    const sizes = {
      default: 'px-4 py-2 text-sm',
      icon: 'h-10 w-10 p-2'
    };
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50 disabled:pointer-events-none',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'flex h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
    );
  }
);

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('rounded-xl border border-slate-800 bg-[#112240]/80 p-6 backdrop-blur-sm', className)}>
    {children}
  </div>
);

// --- Notification Center ---
const NotificationCenter = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const { notifications, markAsRead, unreadCount, testNotification, notificationsEnabled, setNotificationsEnabled } = useAuth();
  const [activeTab, setActiveTab] = useState<'list' | 'settings'>('list');
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied'
  );

  useEffect(() => {
    const checkPermission = () => {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setPermission(Notification.permission);
      }
    };
    checkPermission();
    const interval = setInterval(checkPermission, 1000);
    return () => clearInterval(interval);
  }, []);

  const requestPermission = async () => {
    console.log('Requesting notification permission...');
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const res = await Notification.requestPermission();
        console.log('Permission result:', res);
        setPermission(res);
        if (res === 'granted') {
          testNotification();
        } else if (res === 'denied') {
          alert('Notification permission denied. Please enable it in your browser settings.');
        }
      } catch (err) {
        console.error('Error requesting permission:', err);
        alert('Failed to request permission. Try opening the app in a new tab.');
      }
    } else {
      alert('This browser does not support notifications.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end p-4 sm:p-6 pointer-events-none">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm pointer-events-auto" onClick={onClose} />
      <motion.div 
        initial={{ opacity: 0, y: -20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative w-full max-w-sm rounded-2xl border border-slate-800 bg-[#112240] shadow-2xl pointer-events-auto overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-slate-800 p-4">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-cyan-400" />
            <h2 className="font-bold text-white">Notifications</h2>
            {unreadCount > 0 && (
              <span className="rounded-full bg-cyan-500 px-2 py-0.5 text-[10px] font-bold text-white">
                {unreadCount} New
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setActiveTab(activeTab === 'list' ? 'settings' : 'list')}
              className={cn(
                "rounded-lg p-2 transition-colors",
                activeTab === 'settings' ? "bg-cyan-500/20 text-cyan-400" : "text-slate-400 hover:bg-slate-800"
              )}
            >
              <Settings className="h-5 w-5" />
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-white">
              <XCircle className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="max-h-[400px] overflow-y-auto p-2">
          {activeTab === 'list' ? (
            <div className="space-y-2">
              {notifications.length > 0 ? (
                notifications.map(n => (
                  <div 
                    key={n.id} 
                    className={cn(
                      "group relative rounded-xl border p-3 transition-all",
                      n.read ? "border-slate-800 bg-slate-800/30" : "border-cyan-500/30 bg-cyan-500/5"
                    )}
                  >
                    {!n.read && (
                      <button 
                        onClick={() => markAsRead(n.id)}
                        className="absolute top-3 right-3 text-slate-500 hover:text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Mark as read"
                      >
                        <CheckCircle className="h-4 w-4" />
                      </button>
                    )}
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                      {n.timestamp?.toDate().toLocaleString() || 'Just now'}
                    </p>
                    <h3 className={cn("text-sm font-bold mb-1", n.read ? "text-slate-400" : "text-white")}>
                      {n.title}
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed">{n.message}</p>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                  <Bell className="mb-2 h-8 w-8 opacity-20" />
                  <p className="text-sm">No notifications yet</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 p-2">
              <div className="rounded-xl bg-slate-800/50 p-4">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                  <ShieldCheck className="h-4 w-4 text-cyan-400" />
                  Notification Settings
                </h3>
                
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-white">App Notifications</p>
                      <p className="text-[10px] text-slate-500">Receive alerts inside the app</p>
                    </div>
                    <button 
                      onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                      className="text-cyan-400"
                    >
                      {notificationsEnabled ? <ToggleRight className="h-8 w-8" /> : <ToggleLeft className="h-8 w-8 text-slate-600" />}
                    </button>
                  </div>

                  <div className="border-t border-slate-700 pt-4">
                    <p className="mb-2 text-xs font-medium text-slate-400">System Status</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between rounded-lg bg-slate-900 p-2 text-[11px]">
                        <span className="text-slate-400">Secure Context</span>
                        <span className={cn(
                          "font-bold",
                          typeof window !== 'undefined' && window.isSecureContext ? "text-green-400" : "text-red-400"
                        )}>
                          {typeof window !== 'undefined' && window.isSecureContext ? "YES" : "NO"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-lg bg-slate-900 p-2 text-[11px]">
                        <span className="text-slate-400">Service Worker</span>
                        <span className={cn(
                          "font-bold",
                          typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? "text-green-400" : "text-yellow-400"
                        )}>
                          {typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? "READY" : "NOT SUPPORTED"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-lg bg-slate-900 p-2 text-[11px]">
                        <span className="text-slate-400">Browser Permission</span>
                        <span className={cn(
                          "font-bold",
                          permission === 'granted' ? "text-green-400" : "text-yellow-400"
                        )}>
                          {permission.toUpperCase()}
                        </span>
                      </div>
                      {permission !== 'granted' && (
                        <Button onClick={requestPermission} className="w-full text-[11px] h-8">
                          Request Permission
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-slate-700 pt-4 space-y-2">
                    <Button 
                      variant="secondary" 
                      onClick={testNotification}
                      className="w-full text-[11px] h-8"
                    >
                      <Bell className="mr-2 h-3 w-3" /> Check Eligibility (Test)
                    </Button>
                    <Button 
                      variant="ghost" 
                      onClick={() => window.open(window.location.href, '_blank')}
                      className="w-full text-[11px] h-8 border border-slate-700"
                    >
                      <ExternalLink className="mr-2 h-3 w-3" /> Open in New Tab
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-3">
                <div className="flex gap-2">
                  <Info className="h-4 w-4 text-yellow-500 shrink-0" />
                  <p className="text-[10px] text-yellow-200/70 leading-relaxed">
                    If you're not receiving device alerts, ensure you've enabled permissions and try opening the app in a new tab.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

const LoginPage = () => {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const success = await login(phone, password, pin);
      if (success) {
        navigate('/');
      } else {
        setError('Invalid credentials');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a192f] p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <Card className="border-cyan-900/50">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-white">Mess & T.U.T.</h1>
            <p className="text-cyan-400">Loan Manager</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Phone Number</label>
              <Input 
                type="text" 
                placeholder="017XXXXXXXX" 
                value={phone} 
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Password</label>
              <Input 
                type="password" 
                placeholder="••••••••" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {phone === '01713710607' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
              >
                <label className="mb-1 block text-sm font-medium text-slate-300">Admin PIN</label>
                <Input 
                  type="password" 
                  placeholder="1234" 
                  value={pin} 
                  onChange={(e) => setPin(e.target.value)}
                  required
                />
              </motion.div>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Logging in...' : 'Login'}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-800"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-[#0a192f] px-2 text-slate-500">Or Admin Login</span>
            </div>
          </div>

          <Button 
            variant="secondary" 
            className="w-full border border-slate-700" 
            onClick={async () => {
              setIsLoading(true);
              const success = await loginWithGoogle();
              if (success) navigate('/');
              setIsLoading(false);
            }}
            disabled={isLoading}
          >
            <ShieldCheck className="mr-2 h-4 w-4 text-cyan-400" />
            Login with Google (Admin Only)
          </Button>
        </Card>
      </motion.div>
    </div>
  );
};

const AdminDashboard = () => {
  const [members, setMembers] = useState<Member[]>([]);
  const [billings, setBillings] = useState<Billing[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loans, setLoans] = useState<LoanRequest[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activeTab, setActiveTab] = useState<'members' | 'billing' | 'payments' | 'loans' | 'notices' | 'maintenance'>('members');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [selectedResetCategories, setSelectedResetCategories] = useState<string[]>(['Chef', 'Internet']);
  const [paymentFilter, setPaymentFilter] = useState({ memberId: '', category: '', status: '', month: '', year: '' });
  const [showManualPaymentModal, setShowManualPaymentModal] = useState(false);
  const [manualPayment, setManualPayment] = useState({
    memberId: '',
    category: 'House Rent',
    amount: 0,
    method: 'Cash' as 'Cash' | 'Bkash' | 'Nagad',
    month: new Date().toLocaleString('default', { month: 'long' }),
    year: new Date().getFullYear().toString(),
    transactionIdOrTime: 'Manual Entry by Admin'
  });

  // Member Form
  const [newMember, setNewMember] = useState({ name: '', phone: '', email: '', password: '', fanCount: 0, isGuardian: false });
  
  // Billing Form
  const [newBilling, setNewBilling] = useState<Partial<Billing>>({ 
    category: 'House Rent', 
    totalAmount: 0, 
    month: new Date().toLocaleString('default', { month: 'long' }), 
    year: new Date().getFullYear().toString(),
    billingType: 'Standard',
    selectedMemberIds: []
  });

  // Notice Form
  const [newNotice, setNewNotice] = useState({ title: '', content: '' });

  useEffect(() => {
    const unsubMembers = onSnapshot(collection(db, 'members'), (snapshot) => {
      setMembers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Member)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'members'));
    
    const unsubBillings = onSnapshot(collection(db, 'billings'), (snapshot) => {
      setBillings(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Billing)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'billings'));
    
    const unsubPayments = onSnapshot(query(collection(db, 'payments'), orderBy('timestamp', 'desc')), (snapshot) => {
      setPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'payments'));
    
    const unsubLoans = onSnapshot(query(collection(db, 'loans'), orderBy('timestamp', 'desc')), (snapshot) => {
      setLoans(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LoanRequest)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'loans'));

    const unsubNotices = onSnapshot(collection(db, 'notices'), (snapshot) => {
      setNotices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Notice)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'notices'));

    const unsubNotifications = onSnapshot(collection(db, 'notifications'), (snapshot) => {
      setNotifications(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Notification)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'notifications'));

    return () => {
      unsubMembers();
      unsubBillings();
      unsubPayments();
      unsubLoans();
      unsubNotices();
      unsubNotifications();
    };
  }, []);

  const sendNotification = async (userId: string, title: string, message: string, type: 'bill' | 'notice' | 'reminder') => {
    await addDoc(collection(db, 'notifications'), {
      userId,
      title,
      message,
      type,
      read: false,
      timestamp: serverTimestamp()
    });
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newMember.phone.length !== 11) {
      setError('Phone must be 11 digits');
      return;
    }
    try {
      await addDoc(collection(db, 'members'), { ...newMember, role: 'member' });
      setNewMember({ name: '', phone: '', email: '', password: '', fanCount: 0, isGuardian: false });
    } catch (err) {
      const errInfo = handleFirestoreError(err, OperationType.CREATE, 'members');
      setError(`Failed to add member: ${errInfo.error}`);
    }
  };

  const handleAddBilling = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!newBilling.selectedMemberIds || newBilling.selectedMemberIds.length === 0) {
      setError('Please select at least one member');
      return;
    }

    try {
      let billingData: any = { ...newBilling };
      const selectedMembers = members.filter(m => newBilling.selectedMemberIds?.includes(m.id));

      if (newBilling.billingType === 'Current Bill') {
        const basePortion = newBilling.totalAmount! * 0.4;
        const fanPortion = newBilling.totalAmount! * 0.6;
        const totalFans = selectedMembers.reduce((acc, m) => acc + (m.fanCount || 0), 0);
        
        billingData.calculationDetails = {
          basePortion,
          fanPortion,
          totalFans
        };
      } else {
        billingData.perMemberAmount = selectedMembers.length > 0 ? newBilling.totalAmount! / selectedMembers.length : 0;
      }

      const docRef = await addDoc(collection(db, 'billings'), billingData);
      
      // Notify selected members
      for (const member of selectedMembers) {
        let amount = 0;
        if (newBilling.billingType === 'Current Bill' && billingData.calculationDetails) {
          const base = selectedMembers.length > 0 ? billingData.calculationDetails.basePortion / selectedMembers.length : 0;
          const fan = billingData.calculationDetails.totalFans > 0 
            ? (billingData.calculationDetails.fanPortion / billingData.calculationDetails.totalFans) * (member.fanCount || 0)
            : 0;
          amount = base + fan;
        } else {
          amount = billingData.perMemberAmount || 0;
        }

        const message = `A new bill of ${amount.toFixed(0)} BDT has been added for ${newBilling.month} ${newBilling.year}.`;
        await sendNotification(member.id, `New Bill: ${newBilling.category}`, message, 'bill');
        
        if (member.email) {
          await sendEmailNotification(member.email, `New Bill: ${newBilling.category}`, message);
        }
      }
      
      setNewBilling({ ...newBilling, totalAmount: 0, selectedMemberIds: [] });
    } catch (err) {
      const errInfo = handleFirestoreError(err, OperationType.CREATE, 'billings');
      setError(`Failed to update billing: ${errInfo.error}`);
    }
  };

  const handleSendReminder = async (billing: Billing) => {
    setError(null);
    setIsSending(true);
    try {
      const selectedMembers = members.filter(m => billing.selectedMemberIds?.includes(m.id));
      for (const member of selectedMembers) {
        const isPaid = payments.some(p => p.memberId === member.id && p.category === billing.category && p.status === 'approved');
        if (!isPaid) {
          let amount = 0;
          if (billing.billingType === 'Current Bill' && billing.calculationDetails) {
            const base = selectedMembers.length > 0 ? billing.calculationDetails.basePortion / selectedMembers.length : 0;
            const fan = billing.calculationDetails.totalFans > 0 
              ? (billing.calculationDetails.fanPortion / billing.calculationDetails.totalFans) * (member.fanCount || 0)
              : 0;
            amount = base + fan;
          } else {
            amount = billing.perMemberAmount || 0;
          }

          const message = `Please pay your ${billing.category} bill of ${amount.toFixed(0)} BDT for ${billing.month} ${billing.year}.`;
          await sendNotification(member.id, `Payment Reminder: ${billing.category}`, message, 'reminder');
          
          if (member.email) {
            await sendEmailNotification(member.email, `Payment Reminder: ${billing.category}`, message);
          }
        }
      }
      alert('Reminders sent to all unpaid members!');
    } catch (err) {
      const errInfo = handleFirestoreError(err, OperationType.CREATE, 'notifications');
      setError(`Failed to send reminders: ${errInfo.error}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleManualPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualPayment.memberId || manualPayment.amount <= 0) return;
    
    const member = members.find(m => m.id === manualPayment.memberId);
    if (!member) return;

    try {
      await addDoc(collection(db, 'payments'), {
        ...manualPayment,
        memberName: member.name,
        status: 'approved',
        timestamp: serverTimestamp()
      });
      setShowManualPaymentModal(false);
      setManualPayment({
        memberId: '',
        category: 'House Rent',
        amount: 0,
        method: 'Cash',
        month: new Date().toLocaleString('default', { month: 'long' }),
        year: new Date().getFullYear().toString(),
        transactionIdOrTime: 'Manual Entry by Admin'
      });
    } catch (err) {
      const errInfo = handleFirestoreError(err, OperationType.CREATE, 'payments');
      setError(`Failed to add manual payment: ${errInfo.error}`);
    }
  };

  const handleBulkReset = async (categoriesToAutoPay: string[]) => {
    if (!window.confirm(`CRITICAL ACTION: This will DELETE ALL payment history, ALL notifications, and auto-pay selected categories (${categoriesToAutoPay.join(', ')}) for April 2026 for all non-guardians. Proceed?`)) return;
    
    setIsSending(true);
    setError(null);
    try {
      // 1. Clear all payments
      const paymentDocs = await getDocs(collection(db, 'payments'));
      for (const d of paymentDocs.docs) {
        await deleteDoc(doc(db, 'payments', d.id));
      }

      // 2. Clear all notifications
      const notificationDocs = await getDocs(collection(db, 'notifications'));
      for (const d of notificationDocs.docs) {
        await deleteDoc(doc(db, 'notifications', d.id));
      }

      // 3. Current Month/Year
      const month = "April";
      const year = "2026";

      // 3. Get non-guardian members
      const nonGuardians = members.filter(m => !m.isGuardian);
      
      // 4. Create payments for selected categories
      for (const category of categoriesToAutoPay) {
        const bill = billings.find(b => b.category === category && b.month === month && b.year === year);
        const amount = bill ? (bill.perMemberAmount || 0) : 500; 

        for (const member of nonGuardians) {
          await addDoc(collection(db, 'payments'), {
            memberId: member.id,
            memberName: member.name,
            category,
            amount,
            month,
            year,
            method: 'Cash',
            transactionIdOrTime: 'System Bulk Reset',
            status: 'approved',
            timestamp: serverTimestamp()
          });
        }
      }
      
      alert("Bulk reset and auto-pay complete!");
      setActiveTab('payments');
    } catch (err) {
      const errInfo = handleFirestoreError(err, OperationType.WRITE, 'bulk-reset');
      setError(`Bulk reset failed: ${errInfo.error}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleUpdatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPayment) return;
    setError(null);
    try {
      const { id, ...data } = editingPayment;
      await updateDoc(doc(db, 'payments', id), data);
      setEditingPayment(null);
    } catch (err) {
      const errInfo = handleFirestoreError(err, OperationType.UPDATE, `payments/${editingPayment.id}`);
      setError(`Failed to update payment: ${errInfo.error}`);
    }
  };

  const updateStatus = async (collectionName: string, id: string, status: 'approved' | 'rejected') => {
    setError(null);
    try {
      await updateDoc(doc(db, collectionName, id), { status });
    } catch (err) {
      const errInfo = handleFirestoreError(err, OperationType.UPDATE, `${collectionName}/${id}`);
      setError(`Failed to update status: ${errInfo.error}`);
    }
  };

  const handleDeleteBilling = async (id: string) => {
    setError(null);
    try {
      await deleteDoc(doc(db, 'billings', id));
    } catch (err) {
      const errInfo = handleFirestoreError(err, OperationType.DELETE, `billings/${id}`);
      setError(`Failed to delete billing: ${errInfo.error}`);
    }
  };

  const handleDeleteMember = async (id: string) => {
    setError(null);
    try {
      await deleteDoc(doc(db, 'members', id));
    } catch (err) {
      const errInfo = handleFirestoreError(err, OperationType.DELETE, `members/${id}`);
      setError(`Failed to delete member: ${errInfo.error}`);
    }
  };

  const handleUpdateMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;
    setError(null);
    try {
      const { id, ...data } = editingMember;
      await updateDoc(doc(db, 'members', id), data);
      setEditingMember(null);
    } catch (err) {
      const errInfo = handleFirestoreError(err, OperationType.UPDATE, `members/${editingMember.id}`);
      setError(`Failed to update member: ${errInfo.error}`);
    }
  };

  const handleAddNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await addDoc(collection(db, 'notices'), {
        ...newNotice,
        timestamp: serverTimestamp()
      });

      // Notify all members
      for (const member of members) {
        if (member.role === 'member') {
          await sendNotification(member.id, `New Notice: ${newNotice.title}`, `A new notice has been posted. Please check the notice board.`, 'notice');
          if (member.email) {
            await sendEmailNotification(member.email, `New Notice: ${newNotice.title}`, `A new notice has been posted: ${newNotice.content}`);
          }
        }
      }

      setNewNotice({ title: '', content: '' });
    } catch (err) {
      const errInfo = handleFirestoreError(err, OperationType.CREATE, 'notices');
      setError(`Failed to add notice: ${errInfo.error}`);
    }
  };

  const handleDeleteNotice = async (id: string) => {
    setError(null);
    try {
      await deleteDoc(doc(db, 'notices', id));
    } catch (err) {
      const errInfo = handleFirestoreError(err, OperationType.DELETE, `notices/${id}`);
      setError(`Failed to delete notice: ${errInfo.error}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button variant={activeTab === 'members' ? 'primary' : 'ghost'} onClick={() => setActiveTab('members')}>
          <Users className="mr-2 h-4 w-4" /> Members
        </Button>
        <Button variant={activeTab === 'billing' ? 'primary' : 'ghost'} onClick={() => setActiveTab('billing')}>
          <CreditCard className="mr-2 h-4 w-4" /> Billing
        </Button>
        <Button variant={activeTab === 'payments' ? 'primary' : 'ghost'} onClick={() => setActiveTab('payments')}>
          <History className="mr-2 h-4 w-4" /> Payments
        </Button>
        <Button variant={activeTab === 'loans' ? 'primary' : 'ghost'} onClick={() => setActiveTab('loans')}>
          <DollarSign className="mr-2 h-4 w-4" /> Loans
        </Button>
        <Button variant={activeTab === 'notices' ? 'primary' : 'ghost'} onClick={() => setActiveTab('notices')}>
          <Bell className="mr-2 h-4 w-4" /> Notices
        </Button>
        <Button variant={activeTab === 'maintenance' ? 'primary' : 'ghost'} onClick={() => setActiveTab('maintenance')}>
          <Settings className="mr-2 h-4 w-4" /> Maintenance
        </Button>
      </div>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-4 rounded-lg bg-red-500/20 p-3 text-sm text-red-400">
            {error}
          </motion.div>
        )}
        {activeTab === 'members' && (
          <motion.div key="members" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
            <Card>
              <h2 className="mb-4 text-xl font-semibold text-white">Create Member</h2>
              <form onSubmit={handleAddMember} className="grid gap-4 md:grid-cols-3">
                <Input placeholder="Name" value={newMember.name} onChange={e => setNewMember({...newMember, name: e.target.value})} required />
                <Input placeholder="Phone (11 digits)" value={newMember.phone} onChange={e => setNewMember({...newMember, phone: e.target.value})} required />
                <Input placeholder="Email (Optional)" type="email" value={newMember.email} onChange={e => setNewMember({...newMember, email: e.target.value})} />
                <Input type="password" placeholder="Password" value={newMember.password} onChange={e => setNewMember({...newMember, password: e.target.value})} required />
                <Input type="number" step="0.5" placeholder="Fan Count" value={newMember.fanCount || ''} onChange={e => setNewMember({...newMember, fanCount: Number(e.target.value)})} />
                <div className="flex items-center gap-2 px-3">
                  <input 
                    type="checkbox" 
                    id="isGuardian" 
                    checked={newMember.isGuardian} 
                    onChange={e => setNewMember({...newMember, isGuardian: e.target.checked})}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500"
                  />
                  <label htmlFor="isGuardian" className="text-sm text-slate-300">Is Guardian?</label>
                </div>
                <Button type="submit" className="md:col-span-3"><Plus className="mr-2 h-4 w-4" /> Add Member</Button>
              </form>
            </Card>
            <Card>
              <h2 className="mb-4 text-xl font-semibold text-white">Member List</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="pb-2">Name</th>
                      <th className="pb-2">Phone</th>
                      <th className="pb-2">Fans</th>
                      <th className="pb-2">Type</th>
                      <th className="pb-2">Role</th>
                      <th className="pb-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map(m => (
                      <tr key={m.id} className="border-b border-slate-800/50">
                        <td className="py-2">
                          <div>
                            <p className="font-medium text-white">{m.name}</p>
                            <p className="text-[10px] text-slate-500">{m.email || 'No email'}</p>
                          </div>
                        </td>
                        <td className="py-2">{m.phone}</td>
                        <td className="py-2">{m.fanCount || 0}</td>
                        <td className="py-2">
                          <span className={cn(
                            "rounded-full px-2 py-0.5 text-[10px]",
                            m.isGuardian ? "bg-purple-500/20 text-purple-400" : "bg-blue-500/20 text-blue-400"
                          )}>
                            {m.isGuardian ? 'Guardian' : 'Student'}
                          </span>
                        </td>
                        <td className="py-2 capitalize">{m.role}</td>
                        <td className="py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <button 
                              onClick={() => setEditingMember(m)}
                              className="rounded-full bg-cyan-500/20 p-1.5 text-cyan-400 hover:bg-cyan-500/40"
                              title="Edit Member"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button 
                              onClick={() => handleDeleteMember(m.id)}
                              className="rounded-full bg-red-500/20 p-1.5 text-red-400 hover:bg-red-500/40"
                              title="Delete Member"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </motion.div>
        )}

        {activeTab === 'billing' && (
          <motion.div key="billing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
            <Card>
              <h2 className="mb-4 text-xl font-semibold text-white">Set Monthly Billing</h2>
              <form onSubmit={handleAddBilling} className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-400">Category</label>
                    <select 
                      className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                      value={newBilling.category}
                      onChange={e => setNewBilling({...newBilling, category: e.target.value})}
                    >
                      {['House Rent', 'Chef', 'Internet', 'Waste', 'Electricity', 'Other'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-400">Billing Type</label>
                    <select 
                      className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                      value={newBilling.billingType}
                      onChange={e => setNewBilling({...newBilling, billingType: e.target.value as any})}
                    >
                      <option value="Standard">Standard (Equal Split)</option>
                      <option value="Current Bill">Current Bill (40/60 Split)</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-400">Total Amount (BDT)</label>
                    <Input type="number" placeholder="Total Amount" value={newBilling.totalAmount || ''} onChange={e => setNewBilling({...newBilling, totalAmount: Number(e.target.value)})} required />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-400">Month</label>
                      <Input placeholder="Month" value={newBilling.month} onChange={e => setNewBilling({...newBilling, month: e.target.value})} required />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-400">Year</label>
                      <Input placeholder="Year" value={newBilling.year} onChange={e => setNewBilling({...newBilling, year: e.target.value})} required />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-400">Select Members for this Bill</label>
                    <div className="flex gap-2">
                      <button 
                        type="button"
                        onClick={() => setNewBilling({...newBilling, selectedMemberIds: members.map(m => m.id)})}
                        className="text-[10px] text-cyan-400 hover:underline"
                      >
                        Select All
                      </button>
                      <button 
                        type="button"
                        onClick={() => setNewBilling({...newBilling, selectedMemberIds: members.filter(m => !m.isGuardian).map(m => m.id)})}
                        className="text-[10px] text-cyan-400 hover:underline"
                      >
                        Students Only
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3 md:grid-cols-3">
                    {members.map(m => (
                      <label key={m.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-800 p-1 rounded transition-colors">
                        <input 
                          type="checkbox"
                          checked={newBilling.selectedMemberIds?.includes(m.id)}
                          onChange={e => {
                            const ids = newBilling.selectedMemberIds || [];
                            if (e.target.checked) {
                              setNewBilling({...newBilling, selectedMemberIds: [...ids, m.id]});
                            } else {
                              setNewBilling({...newBilling, selectedMemberIds: ids.filter(id => id !== m.id)});
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500"
                        />
                        <span className="text-xs text-slate-300 truncate">{m.name} {m.isGuardian && '(G)'}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <Button type="submit" className="w-full">Create Billing & Notify Members</Button>
              </form>
            </Card>
            <Card>
              <h2 className="mb-4 text-xl font-semibold text-white">Billing History</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {billings.map(b => (
                  <div key={b.id} className="relative rounded-lg bg-slate-800 p-4 border border-slate-700">
                    <div className="absolute top-2 right-2 flex gap-1">
                      <button 
                        onClick={() => handleSendReminder(b)}
                        className="rounded-full bg-cyan-500/20 p-1.5 text-cyan-400 hover:bg-cyan-500/40"
                        title="Send Reminder"
                        disabled={isSending}
                      >
                        <Bell className="h-4 w-4" />
                      </button>
                      <button 
                        onClick={() => handleDeleteBilling(b.id)}
                        className="rounded-full bg-red-500/20 p-1.5 text-red-400 hover:bg-red-500/40"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">{b.month} {b.year}</p>
                    <h3 className="font-bold text-white">{b.category}</h3>
                    <div className="mt-2 space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Total Amount:</span>
                        <span className="text-white font-medium">{b.totalAmount} BDT</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Type:</span>
                        <span className="text-cyan-400">{b.billingType}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Members:</span>
                        <span className="text-white">{b.selectedMemberIds?.length || 0}</span>
                      </div>
                      {b.billingType === 'Standard' && (
                        <div className="flex justify-between text-xs border-t border-slate-700 pt-1 mt-1">
                          <span className="text-slate-400">Per Member:</span>
                          <span className="text-green-400 font-bold">{b.perMemberAmount?.toFixed(0)} BDT</span>
                        </div>
                      )}
                      {b.billingType === 'Current Bill' && b.calculationDetails && (
                        <div className="mt-1 border-t border-slate-700 pt-1 space-y-1">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-slate-500">Base (40%):</span>
                            <span className="text-slate-300">{b.calculationDetails.basePortion.toFixed(0)} BDT</span>
                          </div>
                          <div className="flex justify-between text-[10px]">
                            <span className="text-slate-500">Fans (60%):</span>
                            <span className="text-slate-300">{b.calculationDetails.fanPortion.toFixed(0)} BDT</span>
                          </div>
                          <div className="flex justify-between text-[10px] border-t border-slate-700/50 pt-1">
                            <span className="text-slate-500">Total Fans:</span>
                            <span className="text-cyan-400 font-medium">{b.calculationDetails.totalFans}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        )}

        {activeTab === 'payments' && (
          <motion.div key="payments" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
            <div className="flex justify-end">
              <Button onClick={() => setShowManualPaymentModal(true)} className="bg-cyan-600 hover:bg-cyan-700">
                <Plus className="mr-2 h-4 w-4" /> Add Manual Payment
              </Button>
            </div>

            <Card>
              <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 items-end">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400 uppercase">Member</label>
                  <select 
                    value={paymentFilter.memberId}
                    onChange={e => setPaymentFilter({...paymentFilter, memberId: e.target.value})}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  >
                    <option value="">All Members</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400 uppercase">Category</label>
                  <select 
                    value={paymentFilter.category}
                    onChange={e => setPaymentFilter({...paymentFilter, category: e.target.value})}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  >
                    <option value="">All Categories</option>
                    {BILLING_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400 uppercase">Month</label>
                  <select 
                    value={paymentFilter.month}
                    onChange={e => setPaymentFilter({...paymentFilter, month: e.target.value})}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  >
                    <option value="">All Months</option>
                    {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400 uppercase">Year</label>
                  <select 
                    value={paymentFilter.year}
                    onChange={e => setPaymentFilter({...paymentFilter, year: e.target.value})}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  >
                    <option value="">All Years</option>
                    {['2024', '2025', '2026'].map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <select 
                    value={paymentFilter.status}
                    onChange={e => setPaymentFilter({...paymentFilter, status: e.target.value})}
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  >
                    <option value="">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <Button variant="ghost" size="icon" onClick={() => setPaymentFilter({ memberId: '', category: '', status: '', month: '', year: '' })}>
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-white">Payment Verifications</h2>
                <div className="text-xs text-slate-400">
                  {(() => {
                    const filtered = payments.filter(p => {
                      const memberMatch = !paymentFilter.memberId || p.memberId === paymentFilter.memberId;
                      const categoryMatch = !paymentFilter.category || p.category === paymentFilter.category;
                      const statusMatch = !paymentFilter.status || p.status === paymentFilter.status;
                      
                      const pMonth = p.month || billings.find(b => b.category === p.category && b.selectedMemberIds?.includes(p.memberId))?.month;
                      const pYear = p.year || billings.find(b => b.category === p.category && b.selectedMemberIds?.includes(p.memberId))?.year;
                      
                      const monthMatch = !paymentFilter.month || pMonth === paymentFilter.month;
                      const yearMatch = !paymentFilter.year || pYear === paymentFilter.year;
                      
                      return memberMatch && categoryMatch && statusMatch && monthMatch && yearMatch;
                    });
                    return `Total: ${filtered.length} records`;
                  })()}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="pb-2">Member</th>
                      <th className="pb-2">Category</th>
                      <th className="pb-2">Amount</th>
                      <th className="pb-2">Method</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const filtered = payments.filter(p => {
                        const memberMatch = !paymentFilter.memberId || p.memberId === paymentFilter.memberId;
                        const categoryMatch = !paymentFilter.category || p.category === paymentFilter.category;
                        const statusMatch = !paymentFilter.status || p.status === paymentFilter.status;
                        
                        const pMonth = p.month || billings.find(b => b.category === p.category && b.selectedMemberIds?.includes(p.memberId))?.month;
                        const pYear = p.year || billings.find(b => b.category === p.category && b.selectedMemberIds?.includes(p.memberId))?.year;
                        
                        const monthMatch = !paymentFilter.month || pMonth === paymentFilter.month;
                        const yearMatch = !paymentFilter.year || pYear === paymentFilter.year;
                        
                        return memberMatch && categoryMatch && statusMatch && monthMatch && yearMatch;
                      });

                      if (filtered.length === 0) {
                        return (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-slate-500 italic">
                              No payment records found for the selected filters.
                            </td>
                          </tr>
                        );
                      }

                      return filtered.map(p => {
                        const pMonth = p.month || billings.find(b => b.category === p.category && b.selectedMemberIds?.includes(p.memberId))?.month;
                        const pYear = p.year || billings.find(b => b.category === p.category && b.selectedMemberIds?.includes(p.memberId))?.year;
                        
                        return (
                          <tr key={p.id} className="border-b border-slate-800/50">
                            <td className="py-2">
                              <div>
                                <p className="font-medium text-white">{p.memberName}</p>
                                <p className="text-[10px] text-slate-500">{p.timestamp?.toDate().toLocaleString() || 'N/A'}</p>
                              </div>
                            </td>
                            <td className="py-2">
                              <div>
                                <p>{p.category}</p>
                                {pMonth && (
                                  <p className="text-[10px] text-cyan-400/60">
                                    {pMonth} {pYear}
                                  </p>
                                )}
                              </div>
                            </td>
                            <td className="py-2 font-medium text-white">{p.amount} BDT</td>
                            <td className="py-2">
                              <div className="flex flex-col">
                                <span className="text-xs text-slate-300">{p.method}</span>
                                <span className="text-[10px] text-slate-500">{p.transactionIdOrTime}</span>
                              </div>
                            </td>
                            <td className="py-2">
                              <span className={cn(
                                'rounded-full px-2 py-0.5 text-[10px]',
                                p.status === 'approved' ? 'bg-green-500/20 text-green-400' : 
                                p.status === 'rejected' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
                              )}>
                                {p.status}
                              </span>
                            </td>
                            <td className="py-2">
                              {p.status === 'pending' ? (
                                <div className="flex gap-2">
                                  <button onClick={() => updateStatus('payments', p.id, 'approved')} className="text-green-400 hover:text-green-300 transition-colors"><CheckCircle className="h-5 w-5" /></button>
                                  <button onClick={() => updateStatus('payments', p.id, 'rejected')} className="text-red-400 hover:text-red-300 transition-colors"><XCircle className="h-5 w-5" /></button>
                                </div>
                              ) : (
                                <button 
                                  onClick={() => setEditingPayment(p)}
                                  className="rounded-full bg-slate-700/50 p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
                                  title="Edit Payment"
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Due Tracking Section */}
            <Card>
              <h2 className="mb-4 text-xl font-semibold text-white">Due Tracking (Unpaid Members)</h2>
              <p className="mb-4 text-xs text-slate-400">Select a category above to see who hasn't paid for it.</p>
              
              {paymentFilter.category ? (
                <div className="space-y-4">
                  {billings
                    .filter(b => b.category === paymentFilter.category)
                    .map(b => {
                      const unpaidMembers = members.filter(m => 
                        b.selectedMemberIds?.includes(m.id) && 
                        !payments.some(p => p.memberId === m.id && p.category === b.category && p.status === 'approved')
                      );

                      return (
                        <div key={b.id} className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <h3 className="font-bold text-white">{b.month} {b.year} - {b.category}</h3>
                            <span className="rounded-full bg-red-500/20 px-2 py-1 text-[10px] font-bold text-red-400">
                              {unpaidMembers.length} Unpaid
                            </span>
                          </div>
                          
                          {unpaidMembers.length > 0 ? (
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {unpaidMembers.map(m => (
                                <div key={m.id} className="flex items-center justify-between rounded bg-slate-800 p-2 text-xs">
                                  <span className="text-slate-300">{m.name}</span>
                                  <span className="text-slate-500">{m.phone}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-green-400">All assigned members have paid!</p>
                          )}
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-slate-500">
                  <Info className="mb-2 h-8 w-8 opacity-20" />
                  <p className="text-sm">Select a category filter to track dues.</p>
                </div>
              )}
            </Card>
          </motion.div>
        )}

        {activeTab === 'loans' && (
          <motion.div key="loans" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Card>
              <h2 className="mb-4 text-xl font-semibold text-white">Pending Loan Requests</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="pb-2">Member</th>
                      <th className="pb-2">Amount</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loans.map(l => (
                      <tr key={l.id} className="border-b border-slate-800/50">
                        <td className="py-2">{l.memberName}</td>
                        <td className="py-2">{l.amount} BDT</td>
                        <td className="py-2">
                          <span className={cn(
                            'rounded-full px-2 py-0.5 text-xs',
                            l.status === 'approved' ? 'bg-green-500/20 text-green-400' : 
                            l.status === 'rejected' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
                          )}>
                            {l.status}
                          </span>
                        </td>
                        <td className="py-2">
                          {l.status === 'pending' && (
                            <div className="flex gap-2">
                              <button onClick={() => updateStatus('loans', l.id, 'approved')} className="text-green-400 hover:text-green-300"><CheckCircle className="h-5 w-5" /></button>
                              <button onClick={() => updateStatus('loans', l.id, 'rejected')} className="text-red-400 hover:text-red-300"><XCircle className="h-5 w-5" /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </motion.div>
        )}

        {activeTab === 'notices' && (
          <motion.div key="notices" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
            <Card>
              <h2 className="mb-4 text-xl font-semibold text-white">Post New Notice</h2>
              <form onSubmit={handleAddNotice} className="space-y-4">
                <Input 
                  placeholder="Notice Title" 
                  value={newNotice.title} 
                  onChange={e => setNewNotice({...newNotice, title: e.target.value})} 
                  required 
                />
                <textarea 
                  className="flex min-h-[100px] w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="Notice Content..."
                  value={newNotice.content}
                  onChange={e => setNewNotice({...newNotice, content: e.target.value})}
                  required
                />
                <Button type="submit" className="w-full"><Plus className="mr-2 h-4 w-4" /> Post Notice</Button>
              </form>
            </Card>
            <Card>
              <h2 className="mb-4 text-xl font-semibold text-white">Recent Notices</h2>
              <div className="space-y-4">
                {notices.map(notice => (
                  <div key={notice.id} className="relative rounded-lg bg-slate-800 p-4 border-l-4 border-cyan-500">
                    <button 
                      onClick={() => handleDeleteNotice(notice.id)}
                      className="absolute top-2 right-2 rounded-full bg-red-500/20 p-1.5 text-red-400 hover:bg-red-500/40"
                      title="Delete Notice"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <p className="text-xs text-slate-400">{notice.timestamp?.toDate().toLocaleString() || 'Recent'}</p>
                    <h3 className="text-lg font-bold text-white">{notice.title}</h3>
                    <p className="mt-2 text-sm text-slate-300 whitespace-pre-wrap">{notice.content}</p>
                  </div>
                ))}
                {notices.length === 0 && <p className="text-center text-slate-500 py-8">No notices posted yet.</p>}
              </div>
            </Card>
          </motion.div>
        )}

        {activeTab === 'maintenance' && (
          <motion.div key="maintenance" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
            <Card className="border-red-500/30">
              <div className="flex items-center gap-3 mb-4">
                <div className="rounded-full bg-red-500/20 p-2 text-red-400">
                  <Settings className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white">System Maintenance</h2>
                  <p className="text-sm text-slate-400">Critical bulk operations for database management.</p>
                </div>
              </div>
              
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg bg-slate-800/50 p-4 border border-slate-700">
                  <h3 className="font-medium text-white mb-2">Bulk Reset & Auto-Pay</h3>
                  <p className="text-xs text-slate-400 mb-4">
                    This will clear ALL payment history, ALL notifications, and automatically mark selected categories as PAID for all students (non-guardians) for April 2026.
                  </p>
                  
                  <div className="mb-4 space-y-2">
                    <p className="text-[10px] font-bold text-slate-500 uppercase">Select Categories to Auto-Pay:</p>
                    <div className="grid grid-cols-2 gap-2">
                      {BILLING_CATEGORIES.map(cat => (
                        <div key={cat} className="flex items-center gap-2">
                          <input 
                            type="checkbox" 
                            id={`reset-${cat}`}
                            checked={selectedResetCategories.includes(cat)}
                            className="h-3 w-3 rounded border-slate-700 bg-slate-800 text-cyan-500"
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedResetCategories([...selectedResetCategories, cat]);
                              } else {
                                setSelectedResetCategories(selectedResetCategories.filter(c => c !== cat));
                              }
                            }}
                          />
                          <label htmlFor={`reset-${cat}`} className="text-xs text-slate-300">{cat}</label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Button 
                    variant="secondary" 
                    className="w-full bg-red-600 hover:bg-red-700 text-white border-none"
                    onClick={() => handleBulkReset(selectedResetCategories)}
                    disabled={isSending}
                  >
                    {isSending ? 'Processing...' : 'Run Bulk Reset'}
                  </Button>
                </div>
                
                <div className="rounded-lg bg-slate-800/50 p-4 border border-slate-700">
                  <h3 className="font-medium text-white mb-2">System Info</h3>
                  <div className="space-y-1 text-xs text-slate-400">
                    <p>Current Month: <span className="text-cyan-400">April</span></p>
                    <p>Current Year: <span className="text-cyan-400">2026</span></p>
                    <p>Total Members: <span className="text-cyan-400">{members.length}</span></p>
                    <p>Students: <span className="text-cyan-400">{members.filter(m => !m.isGuardian).length}</span></p>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Member Modal */}
      <AnimatePresence>
        {editingMember && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.9, opacity: 0 }} 
              className="w-full max-w-md"
            >
              <Card className="border-cyan-500">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-white">Edit Member</h2>
                  <button onClick={() => setEditingMember(null)} className="text-slate-400 hover:text-white">
                    <XCircle className="h-6 w-6" />
                  </button>
                </div>
                <form onSubmit={handleUpdateMember} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">Name</label>
                    <Input 
                      value={editingMember.name} 
                      onChange={e => setEditingMember({...editingMember, name: e.target.value})} 
                      required 
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">Phone</label>
                    <Input 
                      value={editingMember.phone} 
                      onChange={e => setEditingMember({...editingMember, phone: e.target.value})} 
                      required 
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">Email</label>
                    <Input 
                      type="email"
                      value={editingMember.email || ''} 
                      onChange={e => setEditingMember({...editingMember, email: e.target.value})} 
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">Fan Count</label>
                    <Input 
                      type="number"
                      step="0.5"
                      value={editingMember.fanCount || 0} 
                      onChange={e => setEditingMember({...editingMember, fanCount: Number(e.target.value)})} 
                    />
                  </div>
                  <div className="flex items-center gap-2 py-2">
                    <input 
                      type="checkbox" 
                      id="editIsGuardian" 
                      checked={editingMember.isGuardian} 
                      onChange={e => setEditingMember({...editingMember, isGuardian: e.target.checked})}
                      className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500"
                    />
                    <label htmlFor="editIsGuardian" className="text-sm text-slate-300">Is Guardian?</label>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button type="button" variant="ghost" className="flex-1" onClick={() => setEditingMember(null)}>Cancel</Button>
                    <Button type="submit" className="flex-1">Save Changes</Button>
                  </div>
                </form>
              </Card>
            </motion.div>
          </div>
        )}

        {editingPayment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="w-full max-w-md">
              <Card className="border-cyan-500">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-white">Edit Payment</h2>
                  <button onClick={() => setEditingPayment(null)} className="text-slate-400 hover:text-white">
                    <XCircle className="h-6 w-6" />
                  </button>
                </div>
                <form onSubmit={handleUpdatePayment} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">Member</label>
                    <p className="text-white font-medium">{editingPayment.memberName}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-sm text-slate-400">Category</label>
                      <select 
                        className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                        value={editingPayment.category}
                        onChange={e => setEditingPayment({...editingPayment, category: e.target.value})}
                      >
                        {BILLING_CATEGORIES.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-slate-400">Amount</label>
                      <Input 
                        type="number"
                        value={editingPayment.amount}
                        onChange={e => setEditingPayment({...editingPayment, amount: Number(e.target.value)})}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-sm text-slate-400">Month</label>
                      <select 
                        className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                        value={editingPayment.month}
                        onChange={e => setEditingPayment({...editingPayment, month: e.target.value})}
                      >
                        {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-slate-400">Year</label>
                      <select 
                        className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                        value={editingPayment.year}
                        onChange={e => setEditingPayment({...editingPayment, year: e.target.value})}
                      >
                        {['2024', '2025', '2026'].map(y => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">Status</label>
                    <select 
                      className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                      value={editingPayment.status}
                      onChange={e => setEditingPayment({...editingPayment, status: e.target.value as any})}
                    >
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button type="button" variant="ghost" className="flex-1" onClick={() => setEditingPayment(null)}>Cancel</Button>
                    <Button type="submit" className="flex-1">Save Changes</Button>
                  </div>
                </form>
              </Card>
            </motion.div>
          </div>
        )}

        {showManualPaymentModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="w-full max-w-md">
              <Card className="border-cyan-500">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-white">Add Manual Payment</h2>
                  <button onClick={() => setShowManualPaymentModal(false)} className="text-slate-400 hover:text-white">
                    <XCircle className="h-6 w-6" />
                  </button>
                </div>
                <form onSubmit={handleManualPayment} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-400 uppercase">Select Member</label>
                    <select 
                      required
                      className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                      value={manualPayment.memberId}
                      onChange={e => setManualPayment({...manualPayment, memberId: e.target.value})}
                    >
                      <option value="">Choose a member...</option>
                      {members.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-400 uppercase">Category</label>
                      <select 
                        className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                        value={manualPayment.category}
                        onChange={e => setManualPayment({...manualPayment, category: e.target.value})}
                      >
                        {BILLING_CATEGORIES.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-400 uppercase">Amount (BDT)</label>
                      <Input 
                        type="number"
                        placeholder="0"
                        value={manualPayment.amount}
                        onChange={e => setManualPayment({...manualPayment, amount: Number(e.target.value)})}
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-400 uppercase">Month</label>
                      <select 
                        className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                        value={manualPayment.month}
                        onChange={e => setManualPayment({...manualPayment, month: e.target.value})}
                      >
                        {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-400 uppercase">Year</label>
                      <select 
                        className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                        value={manualPayment.year}
                        onChange={e => setManualPayment({...manualPayment, year: e.target.value})}
                      >
                        {['2024', '2025', '2026'].map(y => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-400 uppercase">Payment Method</label>
                    <select 
                      className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                      value={manualPayment.method}
                      onChange={e => setManualPayment({...manualPayment, method: e.target.value as any})}
                    >
                      <option value="Cash">Cash</option>
                      <option value="Bkash">Bkash</option>
                      <option value="Nagad">Nagad</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-400 uppercase">Reference/Note</label>
                    <Input 
                      placeholder="e.g. Paid in person"
                      value={manualPayment.transactionIdOrTime}
                      onChange={e => setManualPayment({...manualPayment, transactionIdOrTime: e.target.value})}
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button type="button" variant="ghost" className="flex-1" onClick={() => setShowManualPaymentModal(false)}>Cancel</Button>
                    <Button type="submit" className="flex-1 bg-cyan-600 hover:bg-cyan-700">Confirm Payment</Button>
                  </div>
                </form>
              </Card>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const MemberDashboard = () => {
  const { user, notifications, markAsRead, testNotification } = useAuth();
  const [billings, setBillings] = useState<Billing[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loans, setLoans] = useState<LoanRequest[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [showPayModal, setShowPayModal] = useState<{ category: string; amount: number; month: string; year: string } | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied'
  );

  // Payment Form
  const [payMethod, setPayMethod] = useState<'Cash' | 'Bkash' | 'Nagad'>('Cash');
  const [payInfo, setPayInfo] = useState('');
  const [historyFilter, setHistoryFilter] = useState({ month: '', year: '' });

  const requestNotificationPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === 'granted') {
        testNotification();
      }
    }
  };

  useEffect(() => {
    if (!user) return;
    const unsubBillings = onSnapshot(collection(db, 'billings'), (snapshot) => {
      setBillings(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Billing)));
    });
    const unsubPayments = onSnapshot(query(collection(db, 'payments'), where('memberId', '==', user.id), orderBy('timestamp', 'desc')), (snapshot) => {
      setPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment)));
    });
    const unsubLoans = onSnapshot(query(collection(db, 'loans'), where('memberId', '==', user.id), orderBy('timestamp', 'desc')), (snapshot) => {
      setLoans(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LoanRequest)));
    });
    const unsubNotices = onSnapshot(collection(db, 'notices'), (snapshot) => {
      setNotices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Notice)));
    });

    return () => {
      unsubBillings();
      unsubPayments();
      unsubLoans();
      unsubNotices();
    };
  }, [user]);

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !showPayModal) return;
    await addDoc(collection(db, 'payments'), {
      memberId: user.id,
      memberName: user.name,
      category: showPayModal.category,
      amount: showPayModal.amount,
      month: showPayModal.month,
      year: showPayModal.year,
      method: payMethod,
      transactionIdOrTime: payInfo,
      status: 'pending',
      timestamp: serverTimestamp()
    });
    setShowPayModal(null);
    setPayInfo('');
  };

  const getCategoryIcon = (cat: string) => {
    switch(cat) {
      case 'House Rent': return <Home className="h-6 w-6 text-cyan-400" />;
      case 'Chef': return <ChefHat className="h-6 w-6 text-pink-400" />; // Pink for a female touch as requested
      case 'Internet': return <Wifi className="h-6 w-6 text-blue-400" />;
      case 'Waste': return <Trash2 className="h-6 w-6 text-slate-400" />;
      case 'Electricity': return <Zap className="h-6 w-6 text-yellow-400" />;
      case 'Meal': return <Utensils className="h-6 w-6 text-orange-400" />;
      default: return <CreditCard className="h-6 w-6 text-cyan-400" />;
    }
  };

  return (
    <div className="space-y-8">
      {/* Payment Info Section */}
      <section>
        <Card className="border-cyan-500/30 bg-cyan-500/5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-cyan-500/20 p-2 text-cyan-400">
                <Info className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Payment Information</h2>
                <p className="text-xs text-slate-400">Please pay to the following personal accounts:</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-3 rounded-lg bg-slate-800/50 p-3 border border-slate-700">
                <div className="h-8 w-8 rounded bg-pink-500/20 p-1.5 text-pink-500">
                  <CreditCard className="h-full w-full" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-pink-500 uppercase">Bkash (Personal)</p>
                  <p className="text-sm font-mono text-white">01713710607</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-slate-800/50 p-3 border border-slate-700">
                <div className="h-8 w-8 rounded bg-orange-500/20 p-1.5 text-orange-500">
                  <CreditCard className="h-full w-full" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-orange-500 uppercase">Nagad (Personal)</p>
                  <p className="text-sm font-mono text-white">01921801100</p>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* Notifications Section */}
      {notifications.some(n => !n.read) && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-cyan-400" />
            <h2 className="text-xl font-bold text-white">New Notifications</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {notifications.filter(n => !n.read).map(n => (
              <motion.div 
                key={n.id} 
                initial={{ opacity: 0, x: -20 }} 
                animate={{ opacity: 1, x: 0 }}
                className={cn(
                  "relative rounded-xl border p-4 transition-all",
                  n.type === 'bill' ? "border-yellow-500/30 bg-yellow-500/5" :
                  n.type === 'notice' ? "border-cyan-500/30 bg-cyan-500/5" :
                  "border-red-500/30 bg-red-500/5"
                )}
              >
                <button 
                  onClick={() => markAsRead(n.id)}
                  className="absolute top-2 right-2 text-slate-500 hover:text-white"
                  title="Dismiss"
                >
                  <XCircle className="h-4 w-4" />
                </button>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                  {n.timestamp?.toDate().toLocaleString() || 'Just now'}
                </p>
                <h3 className="font-bold text-white mb-1">{n.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{n.message}</p>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {notices.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Bell className="h-5 w-5 text-cyan-400 animate-pulse" />
            <h2 className="text-xl font-semibold text-white">Notice Board</h2>
          </div>
          <div className="space-y-3">
            {notices.map(notice => (
              <motion.div 
                key={notice.id}
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                className="rounded-lg bg-slate-800/50 p-4 border-l-4 border-cyan-500 backdrop-blur-sm"
              >
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-bold text-white">{notice.title}</h3>
                  <span className="text-[10px] text-slate-500 uppercase">{notice.timestamp?.toDate().toLocaleDateString()}</span>
                </div>
                <p className="text-sm text-slate-300 whitespace-pre-wrap">{notice.content}</p>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Monthly Bills</h2>
          <p className="text-sm text-slate-400">Current Month: {new Date().toLocaleString('default', { month: 'long' })} {new Date().getFullYear()}</p>
        </div>
        
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {BILLING_CATEGORIES.map(category => {
            const b = billings.find(bill => 
              bill.category === category && 
              bill.selectedMemberIds?.includes(user?.id || '') &&
              bill.month === new Date().toLocaleString('default', { month: 'long' }) &&
              bill.year === new Date().getFullYear().toString()
            );

            if (!b) {
              return (
                <div key={category}>
                  <Card className="border-slate-800/50 bg-slate-900/20 opacity-60 grayscale">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-wider">Status</p>
                        <h3 className="text-lg font-bold text-slate-500">{category}</h3>
                        <p className="mt-1 text-[10px] text-slate-600 italic">Bill details pending from manager</p>
                      </div>
                      <div className="opacity-30">
                        {getCategoryIcon(category)}
                      </div>
                    </div>
                    <div className="mt-8 flex items-center justify-center rounded-lg border border-dashed border-slate-800 py-4">
                      <Clock className="mr-2 h-4 w-4 text-slate-700" />
                      <span className="text-xs text-slate-600 font-medium uppercase tracking-widest">Awaiting Input</span>
                    </div>
                  </Card>
                </div>
              );
            }

            const isPaid = payments.some(p => p.category === b.category && p.status === 'approved');
            const isPending = payments.some(p => p.category === b.category && p.status === 'pending');
            
            let amount = 0;
            if (b.billingType === 'Current Bill' && b.calculationDetails && b.selectedMemberIds) {
              const base = b.calculationDetails.basePortion / b.selectedMemberIds.length;
              const fan = b.calculationDetails.totalFans > 0 
                ? (b.calculationDetails.fanPortion / b.calculationDetails.totalFans) * (user?.fanCount || 0)
                : 0;
              amount = base + fan;
            } else {
              amount = b.perMemberAmount || 0;
            }

            return (
              <motion.div 
                key={b.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Card className={cn(
                  "relative overflow-hidden transition-all hover:shadow-lg hover:shadow-cyan-500/5",
                  isPaid ? 'border-green-500/50 bg-green-500/5' : 'border-slate-800'
                )}>
                  {isPaid && (
                    <div className="absolute -right-8 -top-8 rotate-45 bg-green-500 px-10 py-1 text-[10px] font-bold text-white">
                      PAID
                    </div>
                  )}
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{b.month} {b.year}</p>
                      <h3 className="text-lg font-bold text-white">{b.category}</h3>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium",
                          b.billingType === 'Current Bill' ? "bg-cyan-500/20 text-cyan-400" : "bg-purple-500/20 text-purple-400"
                        )}>
                          {b.billingType}
                        </span>
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-800/50 p-2">
                      {getCategoryIcon(b.category)}
                    </div>
                  </div>
                  
                  <div className="mt-6">
                    <div className="flex items-baseline gap-1">
                      <p className="text-3xl font-black text-white">{amount.toFixed(0)}</p>
                      <p className="text-xs font-bold text-slate-500 uppercase">BDT</p>
                    </div>
                    
                    {b.billingType === 'Current Bill' && b.calculationDetails && b.selectedMemberIds && (
                      <div className="mt-3 space-y-1 rounded-lg bg-slate-950/50 p-2">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-slate-500">Base Portion (40%)</span>
                          <span className="text-slate-300">{(b.calculationDetails.basePortion / b.selectedMemberIds.length).toFixed(0)} BDT</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-slate-500">Fan Portion (60% - {user?.fanCount || 0} Fan)</span>
                          <span className="text-slate-300">
                            {b.calculationDetails.totalFans > 0 
                              ? ((b.calculationDetails.fanPortion / b.calculationDetails.totalFans) * (user?.fanCount || 0)).toFixed(0)
                              : 0} BDT
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-6">
                    {isPaid ? (
                      <div className="flex items-center justify-center rounded-lg bg-green-500/10 py-2.5 text-green-400 text-sm font-bold">
                        <CheckCircle className="mr-2 h-4 w-4" /> Payment Verified
                      </div>
                    ) : isPending ? (
                      <div className="flex items-center justify-center rounded-lg bg-yellow-500/10 py-2.5 text-yellow-400 text-sm font-bold">
                        <Clock className="mr-2 h-4 w-4 animate-pulse" /> Pending Approval
                      </div>
                    ) : (
                      <Button 
                        onClick={() => setShowPayModal({ 
                          category: b.category, 
                          amount: Number(amount.toFixed(0)),
                          month: b.month,
                          year: b.year
                        })} 
                        className="w-full shadow-lg shadow-cyan-500/20"
                      >
                        Pay Now
                      </Button>
                    )}
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <Card className="border-cyan-500/30">
          <h2 className="mb-2 text-xl font-semibold text-white">Need Cash?</h2>
          <p className="mb-4 text-sm text-slate-400">Apply for a T.U.T. MLA Loan instantly via our dedicated loan portal.</p>
          <a 
            href="https://ais-pre-bo5opclp4lvfjrzc2bxtnd-813806389941.asia-southeast1.run.app" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="flex w-full items-center justify-center rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 transition-colors"
          >
            <ExternalLink className="mr-2 h-4 w-4" /> Apply for T.U.T. Loan
          </a>
        </Card>
        <Card className="border-green-500/30">
          <h2 className="mb-2 text-xl font-semibold text-white">Support</h2>
          <p className="mb-4 text-sm text-slate-400">Have issues? Contact the manager directly via WhatsApp.</p>
          <a 
            href="https://wa.me/8801713710607" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="flex w-full items-center justify-center rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
          >
            <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp Manager
          </a>
        </Card>
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-white">Payment History</h2>
          <div className="flex items-center gap-2">
            <select 
              value={historyFilter.month}
              onChange={e => setHistoryFilter({...historyFilter, month: e.target.value})}
              className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              <option value="">All Months</option>
              {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <select 
              value={historyFilter.year}
              onChange={e => setHistoryFilter({...historyFilter, year: e.target.value})}
              className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              <option value="">All Years</option>
              {['2024', '2025', '2026'].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {(historyFilter.month || historyFilter.year) && (
              <button 
                onClick={() => setHistoryFilter({ month: '', year: '' })}
                className="text-[10px] text-cyan-400 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Category</th>
                  <th className="pb-2">Bill Period</th>
                  <th className="pb-2">Amount</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const filtered = payments.filter(p => {
                    const pMonth = p.month || billings.find(b => b.category === p.category && b.selectedMemberIds?.includes(user?.id || ''))?.month;
                    const pYear = p.year || billings.find(b => b.category === p.category && b.selectedMemberIds?.includes(user?.id || ''))?.year;
                    
                    const monthMatch = !historyFilter.month || pMonth === historyFilter.month;
                    const yearMatch = !historyFilter.year || pYear === historyFilter.year;
                    return monthMatch && yearMatch;
                  });

                  if (filtered.length === 0) {
                    return (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500 italic">
                          No payment records found for the selected period.
                        </td>
                      </tr>
                    );
                  }

                  return filtered.map(p => {
                    const pMonth = p.month || billings.find(b => b.category === p.category && b.selectedMemberIds?.includes(user?.id || ''))?.month;
                    const pYear = p.year || billings.find(b => b.category === p.category && b.selectedMemberIds?.includes(user?.id || ''))?.year;
                    
                    return (
                      <tr key={p.id} className="border-b border-slate-800/50">
                        <td className="py-2">
                          <div className="flex flex-col">
                            <span>{p.timestamp?.toDate().toLocaleDateString() || 'Recent'}</span>
                            <span className="text-[10px] text-slate-500">{p.method}</span>
                          </div>
                        </td>
                        <td className="py-2 font-medium text-white">{p.category}</td>
                        <td className="py-2 text-xs text-cyan-400/70">
                          {pMonth} {pYear}
                        </td>
                        <td className="py-2 font-bold text-white">{p.amount} BDT</td>
                        <td className="py-2">
                          <span className={cn(
                            'rounded-full px-2 py-0.5 text-[10px]',
                            p.status === 'approved' ? 'bg-green-500/20 text-green-400' : 
                            p.status === 'rejected' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
                          )}>
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* Modals */}
      <AnimatePresence>
        {showPayModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="w-full max-w-md">
              <Card className="border-cyan-500">
                <h2 className="mb-4 text-xl font-bold text-white">Pay for {showPayModal.category}</h2>
                <form onSubmit={handlePayment} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm text-slate-400">Payment Method</label>
                    <select 
                      className="flex h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                      value={payMethod}
                      onChange={e => setPayMethod(e.target.value as any)}
                    >
                      <option value="Cash">Cash</option>
                      <option value="Bkash">Bkash</option>
                      <option value="Nagad">Nagad</option>
                    </select>
                  </div>

                  {payMethod !== 'Cash' && (
                    <div className="rounded-lg bg-slate-900/50 p-3 border border-slate-800">
                      <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Send Money to:</p>
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-mono text-cyan-400">
                          {payMethod === 'Bkash' ? '01713710607' : '01921801100'}
                        </span>
                        <span className="text-[10px] rounded bg-slate-800 px-2 py-0.5 text-slate-400">Personal</span>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="mb-1 block text-sm text-slate-400">
                      {payMethod === 'Cash' ? 'Payment Time' : 'Transaction ID'}
                    </label>
                    <Input 
                      placeholder={payMethod === 'Cash' ? 'e.g. 10:30 AM' : 'e.g. TRN123456'} 
                      value={payInfo}
                      onChange={e => setPayInfo(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" className="flex-1" onClick={() => setShowPayModal(null)}>Cancel</Button>
                    <Button type="submit" className="flex-1">Submit Payment</Button>
                  </div>
                </form>
              </Card>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Layout = ({ children }: { children: React.ReactNode }) => {
  const { user, logout, unreadCount } = useAuth();
  const navigate = useNavigate();
  const [isNotifOpen, setIsNotifOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#0a192f] text-white">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-[#0a192f]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500 text-white">
              <LayoutDashboard className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white leading-tight">Mess & T.U.T.</h1>
              <p className="text-xs text-cyan-400">Manager</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative">
              <button 
                onClick={() => setIsNotifOpen(true)}
                className="relative rounded-full p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                )}
              </button>
            </div>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-white">{user?.name}</p>
              <p className="text-xs text-slate-400 capitalize">{user?.role}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => { logout(); navigate('/login'); }}>
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>
      <NotificationCenter isOpen={isNotifOpen} onClose={() => setIsNotifOpen(false)} />
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        {children}
      </main>
    </div>
  );
};

// --- App ---

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={
            <ProtectedRoute>
              <Layout>
                <DashboardSwitcher />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-[#0a192f] text-white">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const DashboardSwitcher = () => {
  const { user } = useAuth();
  return user?.role === 'admin' ? <AdminDashboard /> : <MemberDashboard />;
};
