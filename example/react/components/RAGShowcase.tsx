import { useEffect, useRef } from 'react';
import { mountRAGAPIShowcase } from '../../shared/ragApiShowcase';

export const RAGShowcase = () => {
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (ref.current) {
			mountRAGAPIShowcase(ref.current);
		}
	}, []);

	return <div ref={ref} />;
};
