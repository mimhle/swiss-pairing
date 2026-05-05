import { siNextdotjs, siReact, siTailwindcss, siSkeleton, siGithub } from "simple-icons";

const frameworks = [
    { name: "Next.js", url: "https://nextjs.org", icon: siNextdotjs },
    { name: "React", url: "https://react.dev", icon: siReact },
    { name: "Tailwind CSS", url: "https://tailwindcss.com", icon: siTailwindcss },
    { name: "Skeleton", url: "https://www.skeleton.dev", icon: siSkeleton },
];

function BrandIcon({ icon, size = 14 }) {
    return (
        <svg
            role="img"
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill="currentColor"
            aria-label={icon.title}
        >
            <path d={icon.path} />
        </svg>
    );
}

export default function Footer() {
    return (
        <footer className="border-t border-surface-200-800 mt-auto">
            <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between text-sm text-surface-400-600">
                <div className="flex items-center gap-2">
                    <span>&copy; {new Date().getFullYear()} Lê Ngọc Minh</span>
                    <a
                        href="https://github.com/mimhle"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-primary-500 transition-colors"
                        title="GitHub Repository"
                    >
                        <BrandIcon icon={siGithub} />
                    </a>
                </div>
                <div className="flex items-center gap-4">
                    {frameworks.map(({ name, url, icon }, i) => (
                        <span key={name} className="flex items-center gap-4">
                            <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 hover:text-primary-500 transition-colors"
                            >
                                <BrandIcon icon={icon} />
                                {name}
                            </a>
                            {i < frameworks.length - 1 && <span className="opacity-30">·</span>}
                        </span>
                    ))}
                </div>
            </div>
        </footer>
    );
}
