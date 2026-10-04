import { Link } from 'react-router';
import { t } from '../i18n/pt-BR';

export function NotFound() {
  return (
    <section className="p-6">
      <h1 className="text-2xl font-bold">{t.notFound.title}</h1>
      <Link to="/" className="mt-4 inline-block text-blue-700 underline">
        {t.notFound.back}
      </Link>
    </section>
  );
}

export function Placeholder({ title }: { title: string }) {
  return (
    <section>
      <h1 className="text-2xl font-bold">{title}</h1>
    </section>
  );
}
