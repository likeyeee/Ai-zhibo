import { useEffect, useState } from 'react';
import type { Product } from '@lingbo/shared';
import { formatYuan } from '@lingbo/shared';
import { api } from '../api';
import { ProductCover } from '../components/ProductCover';
import { explainError, useI18n } from '../i18n';

interface FaqDraft {
  question: string;
  answer: string;
}

interface Draft {
  title: string;
  price: string;
  imageUrl: string;
  points: string;
  description: string;
  faqs: FaqDraft[];
}

const emptyDraft = (): Draft => ({
  title: '',
  price: '',
  imageUrl: '',
  points: '',
  description: '',
  faqs: [{ question: '', answer: '' }],
});

function fromProduct(product: Product): Draft {
  return {
    title: product.title,
    price: String(product.priceYuan),
    imageUrl: product.imageUrl ?? '',
    points: product.sellingPoints.join('\n'),
    description: product.description,
    faqs: product.faqs.length ? product.faqs.map((faq) => ({ ...faq })) : [{ question: '', answer: '' }],
  };
}

export function ProductsPage() {
  const { t } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  const load = async () => {
    const { products: next } = await api.products();
    setProducts(next);
    return next;
  };

  useEffect(() => {
    load()
      .catch((reason) => setError(explainError(t, reason)))
      .finally(() => setLoading(false));
  }, [t]);

  const select = (product: Product) => {
    setEditing(product.id);
    setDraft(fromProduct(product));
    setConfirming(false);
    setMessage('');
    setError('');
  };

  const startNew = () => {
    setEditing(null);
    setDraft(emptyDraft());
    setConfirming(false);
    setMessage('');
    setError('');
  };

  const upload = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      const { url } = await api.upload(file);
      setDraft((current) => ({ ...current, imageUrl: url }));
    } catch (reason) {
      setError(explainError(t, reason));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const priceYuan = Number(draft.price);
    if (!draft.title.trim() || !Number.isFinite(priceYuan) || priceYuan <= 0) {
      setError(t('product.invalid'));
      return;
    }
    const faqs = draft.faqs
      .map((faq) => ({ question: faq.question.trim(), answer: faq.answer.trim() }))
      .filter((faq) => faq.question || faq.answer);
    if (faqs.some((faq) => !faq.question || !faq.answer)) {
      setError(t('product.faqHalf'));
      return;
    }
    const body = {
      title: draft.title.trim(),
      priceYuan,
      imageUrl: draft.imageUrl.trim() || null,
      sellingPoints: draft.points
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      faqs,
      description: draft.description.trim(),
    };
    setBusy(true);
    setError('');
    try {
      const { product } = editing ? await api.updateProduct(editing, body) : await api.createProduct(body);
      const next = await load();
      setProducts(next);
      setEditing(product.id);
      setDraft(fromProduct(product));
      setMessage(t('product.saved'));
    } catch (reason) {
      setError(explainError(t, reason));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteProduct(editing);
      await load();
      startNew();
      setMessage(t('product.deleted'));
    } catch (reason) {
      setError(explainError(t, reason));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const seed = async () => {
    setBusy(true);
    setError('');
    try {
      const { created } = await api.seed();
      await load();
      setMessage(created > 0 ? t('product.seeded', { count: created }) : t('product.seedNone'));
    } catch (reason) {
      setError(explainError(t, reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('product.eyebrow')}</p>
          <h1>{t('product.title')}</h1>
          <p className="lede">{t('product.lede')}</p>
        </div>
        <div className="row-actions">
          <button type="button" className="btn ghost" onClick={() => void seed()} disabled={busy}>
            {busy ? t('product.seeding') : t('product.seed')}
          </button>
          <button type="button" className="btn primary" onClick={startNew}>
            {t('product.create')}
          </button>
        </div>
      </header>
      <p className="help">{t('product.demoNote')}</p>
      {error ? <p className="error-banner" role="alert">{error}</p> : null}
      {message ? <p className="status-line" role="status">{message}</p> : null}
      {loading ? <p>{t('common.loading')}</p> : null}
      <div className="product-layout">
        <div className="product-list">
          {products.length === 0 && !loading ? <p className="empty">{t('product.empty')}</p> : null}
          {products.map((product) => (
            <button
              key={product.id}
              type="button"
              className={editing === product.id ? 'product-card active' : 'product-card'}
              onClick={() => select(product)}
            >
              <div className="cover">
                <ProductCover title={product.title} imageUrl={product.imageUrl} />
              </div>
              <span>
                <strong>{product.title}</strong>
                <em>{formatYuan(product.priceYuan)}</em>
                <small>
                  {product.sellingPoints.length} · {product.faqs.length} FAQ
                </small>
              </span>
            </button>
          ))}
        </div>
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h2>{editing ? t('product.edit') : t('product.new')}</h2>
          <label className="field">
            <span>{t('product.fieldTitle')}</span>
            <input
              id="product-title"
              value={draft.title}
              placeholder={t('product.placeholderTitle')}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <label className="field">
            <span>{t('product.fieldPrice')}</span>
            <input
              id="product-price"
              inputMode="decimal"
              value={draft.price}
              onChange={(event) => setDraft({ ...draft, price: event.target.value })}
            />
          </label>
          <div className="field">
            <span>{t('product.fieldImage')}</span>
            <div className="split">
              {draft.imageUrl ? (
                <div className="cover small">
                  <ProductCover title={draft.title || '品'} imageUrl={draft.imageUrl} />
                </div>
              ) : null}
              <label className="btn ghost file-btn">
                {busy ? t('product.uploading') : t('product.upload')}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void upload(file);
                  }}
                />
              </label>
            </div>
            <input
              id="product-image-url"
              value={draft.imageUrl}
              placeholder={t('product.fieldImageUrl')}
              onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })}
            />
          </div>
          <label className="field">
            <span>{t('product.fieldPoints')}</span>
            <textarea
              id="product-points"
              rows={4}
              value={draft.points}
              placeholder={t('product.placeholderPoints')}
              onChange={(event) => setDraft({ ...draft, points: event.target.value })}
            />
            <small className="help">{t('product.fieldPointsHint')}</small>
          </label>
          <label className="field">
            <span>{t('product.fieldDescription')}</span>
            <textarea
              id="product-description"
              rows={3}
              value={draft.description}
              placeholder={t('product.placeholderDesc')}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
          <fieldset className="faq-block">
            <legend>{t('product.fieldFaqs')}</legend>
            {draft.faqs.map((faq, index) => (
              <div className="faq-row" key={index}>
                <input
                  aria-label={t('product.fieldQuestion')}
                  placeholder={t('product.placeholderQuestion')}
                  value={faq.question}
                  onChange={(event) => {
                    const faqs = draft.faqs.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, question: event.target.value } : item,
                    );
                    setDraft({ ...draft, faqs });
                  }}
                />
                <input
                  aria-label={t('product.fieldAnswer')}
                  placeholder={t('product.placeholderAnswer')}
                  value={faq.answer}
                  onChange={(event) => {
                    const faqs = draft.faqs.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, answer: event.target.value } : item,
                    );
                    setDraft({ ...draft, faqs });
                  }}
                />
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setDraft({ ...draft, faqs: draft.faqs.filter((_, itemIndex) => itemIndex !== index) })}
                >
                  {t('product.removeFaq')}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn ghost"
              onClick={() => setDraft({ ...draft, faqs: [...draft.faqs, { question: '', answer: '' }] })}
            >
              {t('product.addFaq')}
            </button>
          </fieldset>
          <div className="row-actions">
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? t('product.saving') : t('product.save')}
            </button>
            {editing ? (
              confirming ? (
                <>
                  <button type="button" className="btn danger" onClick={() => void remove()} disabled={busy}>
                    {t('product.confirmDelete')}
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>
                    {t('product.cancel')}
                  </button>
                </>
              ) : (
                <button type="button" className="btn danger" onClick={() => setConfirming(true)}>
                  {t('product.delete')}
                </button>
              )
            ) : null}
          </div>
        </form>
      </div>
    </section>
  );
}
