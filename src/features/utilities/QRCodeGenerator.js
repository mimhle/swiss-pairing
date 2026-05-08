"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Download, FileImage, QrCode, X, Image as ImageIcon, Upload } from 'lucide-react';
import { HexAlphaColorPicker } from 'react-colorful';

function ColorInput({ label, color, onChange }) {
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef(null);

    const isDark = (hex) => {
        if (!hex || hex.length < 7) return false;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance < 0.5;
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const presets = [
        '#000000ff', '#ffffffff', '#666666ff', '#ef4444ff', '#f97316ff', '#f59e0bff',
        '#10b981ff', '#06b6d4ff', '#3b82f6ff', '#6366f1ff', '#8b5cf6ff', '#f43f5eff'
    ];

    return (
        <div className="flex flex-col gap-1 p-2 border border-surface-200-800 rounded-lg bg-surface-100-900 shadow-sm relative">
            <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-widest">{label}</span>
            <div className="flex items-center gap-1.5">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="h-7 flex-1 rounded border border-surface-300-700 flex items-center px-2 text-[10px] font-mono font-bold transition-all relative overflow-hidden active:scale-95"
                    style={{
                        backgroundColor: color,
                        color: isDark(color) ? '#fff' : '#000',
                        backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc)',
                        backgroundSize: '8px 8px',
                        backgroundPosition: '0 0, 4px 4px'
                    }}
                >
                    <span className="relative z-10 drop-shadow-sm">
                        {color.toUpperCase()}
                    </span>
                    <div className="absolute inset-0 bg-surface-100-900 opacity-20" />
                    <div className="absolute inset-0" style={{ backgroundColor: color }} />
                </button>
            </div>

            {isOpen && (
                <div
                    ref={popoverRef}
                    className="absolute bottom-full left-0 mb-2 z-50 bg-surface-50-950 border border-surface-200-800 rounded-xl shadow-2xl p-3 w-[200px] animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-150"
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-surface-500-400">Color & Alpha</span>
                        <button onClick={() => setIsOpen(false)} className="text-surface-500-400 hover:text-white transition-colors">
                            <X size={12} />
                        </button>
                    </div>

                    <div className="custom-color-picker mb-3">
                        <HexAlphaColorPicker color={color} onChange={onChange} />
                    </div>

                    <div className="grid grid-cols-6 gap-1 mb-3">
                        {presets.map(p => (
                            <button
                                key={p}
                                className={`w-full aspect-square rounded-sm border border-black/10 hover:scale-110 transition-transform ${color.toLowerCase() === p.toLowerCase() ? 'ring-2 ring-primary-500 ring-offset-1 ring-offset-surface-50' : ''}`}
                                style={{ backgroundColor: p }}
                                onClick={() => onChange(p)}
                            />
                        ))}
                    </div>

                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={color}
                            onChange={(e) => onChange(e.target.value)}
                            className="flex-1 bg-surface-100-900 border border-surface-300-700 rounded px-2 py-1 text-[10px] font-mono font-bold outline-none focus:border-primary-500 text-center uppercase"
                        />
                    </div>

                    <style jsx global>{`
                        .custom-color-picker .react-colorful {
                            width: 100%;
                            height: 140px;
                        }
                        .custom-color-picker .react-colorful__saturation {
                            border-radius: 6px 6px 0 0;
                        }
                        .custom-color-picker .react-colorful__hue,
                        .custom-color-picker .react-colorful__alpha {
                            height: 10px;
                            border-radius: 4px;
                            margin-top: 6px;
                        }
                        .custom-color-picker .react-colorful__pointer {
                            width: 14px;
                            height: 14px;
                        }
                    `}</style>
                </div>
            )}
        </div>
    );
}

export default function QRCodeGenerator() {
    const [text, setText] = useState('');
    const [version, setVersion] = useState(0);
    const [boxSize, setBoxSize] = useState(20);
    const [margin, setMargin] = useState(1);
    const [ecl, setEcl] = useState('M');
    const [dotStyle, setDotStyle] = useState('square');
    const [darkColor, setDarkColor] = useState('#000000ff');
    const [lightColor, setLightColor] = useState('#ffffffff');

    const [logo, setLogo] = useState(null);
    const [logoSize, setLogoSize] = useState(20); // % of QR size
    const [logoPadding, setLogoPadding] = useState(2); // pixels

    const [qrDataUrl, setQrDataUrl] = useState('');
    const [outputSize, setOutputSize] = useState(0);
    const [error, setError] = useState(null);
    const canvasRef = useRef(null);

    const handleLogoUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => setLogo(event.target.result);
            reader.readAsDataURL(file);
        }
    };

    const generateQR = useCallback(async () => {
        if (!text) {
            setQrDataUrl('');
            setOutputSize(0);
            setError(null);
            return;
        }

        try {
            setError(null);
            const options = {
                version: version === 0 ? undefined : version,
                errorCorrectionLevel: ecl,
            };

            const qr = QRCode.create(text, options);
            const size = qr.modules.size;
            const canvasSize = (size + margin * 2) * boxSize;
            setOutputSize(canvasSize);

            const canvas = document.createElement('canvas');
            canvas.width = canvasSize;
            canvas.height = canvasSize;
            const ctx = canvas.getContext('2d');

            // Fill background
            ctx.fillStyle = lightColor;
            ctx.fillRect(0, 0, canvasSize, canvasSize);

            // Draw modules
            ctx.fillStyle = darkColor;
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    if (qr.modules.data[r * size + c]) {
                        const x = (c + margin) * boxSize;
                        const y = (r + margin) * boxSize;

                        if (dotStyle === 'round') {
                            ctx.beginPath();
                            ctx.arc(x + boxSize / 2, y + boxSize / 2, boxSize / 2 * 0.85, 0, Math.PI * 2);
                            ctx.fill();
                        } else if (dotStyle === 'rounded-rect') {
                            const radius = boxSize * 0.3;
                            ctx.beginPath();
                            ctx.roundRect(x + 1, y + 1, boxSize - 2, boxSize - 2, radius);
                            ctx.fill();
                        } else {
                            ctx.fillRect(x, y, boxSize, boxSize);
                        }
                    }
                }
            }

            // Draw logo
            if (logo) {
                const img = new Image();
                img.src = logo;
                await new Promise((resolve) => {
                    img.onload = () => {
                        const lSize = (canvasSize * (logoSize / 100));
                        const lx = (canvasSize - lSize) / 2;
                        const ly = (canvasSize - lSize) / 2;

                        // Background for logo to clear QR modules
                        ctx.fillStyle = lightColor;
                        ctx.fillRect(lx - logoPadding, ly - logoPadding, lSize + logoPadding * 2, lSize + logoPadding * 2);

                        ctx.drawImage(img, lx, ly, lSize, lSize);
                        resolve();
                    };
                    img.onerror = resolve; // Continue even if logo fails
                });
            }

            setQrDataUrl(canvas.toDataURL());
        } catch (err) {
            setError(err.message || 'The amount of data is too big for this configuration.');
            setQrDataUrl('');
            setOutputSize(0);
        }
    }, [text, version, ecl, margin, boxSize, lightColor, darkColor, dotStyle, logo, logoSize, logoPadding]);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            void generateQR();
        }, 0);
        return () => clearTimeout(timeoutId);
    }, [generateQR]);

    const handleDownload = () => {
        if (!qrDataUrl) return;
        const link = document.createElement('a');
        link.download = 'qrcode.png';
        link.href = qrDataUrl;
        link.click();
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-8 items-start">
            {/* Settings Column */}
            <div className="space-y-6">
                <div className="flex flex-col gap-2">
                    <span className="text-[11px] text-surface-500-400 font-bold uppercase tracking-widest">Text to generate</span>
                    <textarea
                        className="bg-surface-50-950 border border-surface-200-800 rounded-lg px-4 py-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 w-full min-h-[80px] transition-all shadow-sm"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Enter URL, email, or plain text..."
                    />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                    <div className="space-y-4">
                        <h4 className="text-[11px] font-bold uppercase tracking-widest text-primary-500 mb-2 pb-1 border-b border-surface-200-800">Basic Settings</h4>

                        <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Error Correction</span>
                            <select
                                className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full cursor-pointer"
                                value={ecl}
                                onChange={(e) => setEcl(e.target.value)}
                            >
                                <option value="L">L (7%) - Low</option>
                                <option value="M">M (15%) - Medium</option>
                                <option value="Q">Q (25%) - Quartile</option>
                                <option value="H">H (30%) - High (Recommended for logos)</option>
                            </select>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Dot Style</span>
                            <select
                                className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full cursor-pointer"
                                value={dotStyle}
                                onChange={(e) => setDotStyle(e.target.value)}
                            >
                                <option value="square">Classic Square</option>
                                <option value="round">Round Dots</option>
                                <option value="rounded-rect">Rounded Rectangles</option>
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1.5">
                                <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Box Size (px)</span>
                                <input
                                    type="number"
                                    className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full"
                                    value={boxSize}
                                    onChange={(e) => setBoxSize(parseInt(e.target.value) || 1)}
                                />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Border Size</span>
                                <input
                                    type="number"
                                    className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full"
                                    value={margin}
                                    onChange={(e) => setMargin(parseInt(e.target.value) || 0)}
                                />
                            </div>
                        </div>

                        <div className="space-y-4 pt-2">
                            <ColorInput label="Fill Color" color={darkColor} onChange={setDarkColor} />
                            <ColorInput label="Back Color" color={lightColor} onChange={setLightColor} />
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h4 className="text-[11px] font-bold uppercase tracking-widest text-primary-500 mb-2 pb-1 border-b border-surface-200-800">Logo Customization</h4>

                        <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Insert Logo</span>
                            <div className="flex items-center gap-2">
                                <label className="flex-1 flex items-center justify-center gap-2 bg-surface-100-900 border border-dashed border-surface-300-700 rounded-lg p-4 cursor-pointer hover:bg-surface-200-800 transition-colors group">
                                    <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} />
                                    {logo ? (
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <img src={logo} alt="Logo preview" className="w-8 h-8 rounded object-contain border border-surface-300-700" />
                                            <span className="text-[10px] font-bold text-surface-400 uppercase truncate max-w-[100px]">Update Logo</span>
                                        </div>
                                    ) : (
                                        <>
                                            <Upload size={20} className="text-surface-400 group-hover:text-primary-500 transition-colors" />
                                            <span className="text-[10px] font-bold text-surface-400 uppercase">Upload Image</span>
                                        </>
                                    )}
                                </label>
                                {logo && (
                                    <button
                                        onClick={() => setLogo(null)}
                                        className="p-2 bg-error-500/10 text-error-500 hover:bg-error-500/20 rounded-lg transition-colors border border-error-500/20"
                                    >
                                        <X size={16} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {logo && (
                            <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
                                <div className="flex flex-col gap-1.5">
                                    <div className="flex justify-between items-center">
                                        <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Logo Size ({logoSize}%)</span>
                                        <span className="text-[10px] font-mono text-primary-500 font-bold">{logoSize}%</span>
                                    </div>
                                    <input
                                        type="range" min="5" max="40" step="1"
                                        value={logoSize} onChange={(e) => setLogoSize(parseInt(e.target.value))}
                                        className="w-full accent-primary-500 h-1.5 bg-surface-200-800 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <div className="flex justify-between items-center">
                                        <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Logo Padding</span>
                                        <span className="text-[10px] font-mono text-primary-500 font-bold">{logoPadding}px</span>
                                    </div>
                                    <input
                                        type="range" min="0" max="10" step="1"
                                        value={logoPadding} onChange={(e) => setLogoPadding(parseInt(e.target.value))}
                                        className="w-full accent-primary-500 h-1.5 bg-surface-200-800 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                            </div>
                        )}

                        <div className="p-3 rounded-lg bg-surface-100-900 border border-surface-200-800 space-y-2">
                            <p className="text-[10px] text-surface-500-400 leading-relaxed italic">
                                Tip: Use <span className="font-bold text-primary-500">Error Correction H</span> when inserting a logo to ensure the code remains scannable.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-3 pt-6 border-t border-surface-200-800">
                    <button
                        onClick={handleDownload}
                        disabled={!qrDataUrl}
                        className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition-all shadow-xl shadow-blue-500/20 hover:shadow-blue-500/40 flex items-center gap-3 disabled:opacity-50 active:scale-95 uppercase tracking-[0.1em]"
                    >
                        <Download size={18} />
                        Download PNG
                    </button>
                </div>
            </div>

            {/* Preview Column */}
            <div className="flex flex-col items-center justify-start p-8 bg-surface-100-900 rounded-2xl border border-surface-200-800 relative min-h-[400px] lg:sticky lg:top-4 shadow-inner">
                <span className="absolute top-4 left-4 text-[10px] font-bold uppercase tracking-widest text-surface-600-300 flex items-center gap-2">
                    <ImageIcon size={12} className="text-primary-500" />
                    <span>Live Preview</span>
                    {outputSize > 0 && (
                        <span className="ml-1 px-1.5 py-0.5 rounded bg-primary-500/10 text-primary-500 font-mono text-[9px] border border-primary-500/20 shadow-sm">
                            {outputSize}x{outputSize} px
                        </span>
                    )}
                </span>

                {error && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 text-center animate-in fade-in slide-in-from-top-4 duration-500">
                        <div className="w-20 h-20 rounded-2xl bg-error-500/10 border border-error-500/20 flex items-center justify-center text-error-500 shadow-xl shadow-error-500/5">
                            <X size={40} strokeWidth={1.5} />
                        </div>
                        <div className="space-y-2">
                            <h3 className="text-sm font-black uppercase tracking-widest text-error-500">Generation Failed</h3>
                            <p className="text-xs text-surface-500-400 font-medium leading-relaxed max-w-[240px]">
                                {error}
                            </p>
                        </div>
                    </div>
                )}

                {!qrDataUrl && !error && (
                    <div className="flex-1 flex flex-col items-center justify-center text-surface-500-400 text-xs font-medium gap-6 opacity-30 text-center px-4 animate-pulse">
                        <div className="w-20 h-20 rounded-full bg-surface-300-700 flex items-center justify-center">
                            <QrCode size={40} strokeWidth={1} />
                        </div>
                        <p className="max-w-[180px] uppercase tracking-widest text-[9px] font-black">Configure & Generate</p>
                    </div>
                )}

                {qrDataUrl && (
                    <div className="relative p-8 bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.2)] border border-slate-200 overflow-hidden group animate-in fade-in zoom-in-95 duration-700 mt-2">
                        <img src={qrDataUrl} alt="QR Code" className="w-full max-w-[280px] h-auto transition-transform group-hover:scale-[1.03]" />
                    </div>
                )}

                {qrDataUrl && (
                    <div className="mt-8 flex flex-col items-center gap-2">
                        {(() => {
                            // Calculate Contrast Ratio
                            const getLuminance = (hex) => {
                                const r = parseInt(hex.slice(1, 3), 16) / 255;
                                const g = parseInt(hex.slice(3, 5), 16) / 255;
                                const b = parseInt(hex.slice(5, 7), 16) / 255;
                                const a = [r, g, b].map((v) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
                                return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
                            };

                            const lum1 = getLuminance(darkColor);
                            const lum2 = getLuminance(lightColor);
                            const ratio = (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);

                            let bars = 0;
                            let colorClass = 'bg-surface-200-800';
                            let statusText = 'Unknown';

                            if (ratio < 2) { bars = 1; colorClass = 'bg-red-500'; statusText = 'Poor'; }
                            else if (ratio < 3) { bars = 2; colorClass = 'bg-orange-500'; statusText = 'Fair'; }
                            else if (ratio < 4.5) { bars = 3; colorClass = 'bg-yellow-500'; statusText = 'Good'; }
                            else if (ratio < 7) { bars = 4; colorClass = 'bg-green-400'; statusText = 'Very Good'; }
                            else { bars = 5; colorClass = 'bg-green-600'; statusText = 'Excellent'; }

                            return (
                                <>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[9px] font-black uppercase tracking-widest text-surface-500-400">Scannability</span>
                                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${colorClass.replace('bg-', 'text-').replace('600', '500')} bg-opacity-10`}>
                                            {statusText}
                                        </span>
                                    </div>
                                    <div className="flex gap-1.5">
                                        {[1, 2, 3, 4, 5].map(i => (
                                            <div 
                                                key={i} 
                                                className={`w-6 h-1 rounded-full transition-all duration-500 ${i <= bars ? colorClass : 'bg-surface-200-800'}`} 
                                            />
                                        ))}
                                    </div>
                                    <span className="text-[8px] font-mono text-surface-500-400 opacity-50">Contrast Ratio: {ratio.toFixed(2)}:1</span>
                                </>
                            );
                        })()}
                    </div>
                )}
            </div>
        </div>
    );
}
