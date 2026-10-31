import { useEffect, useRef } from 'react';
import type { Comment } from '@lingbo/shared';
import { useI18n } from '../i18n';

export function CommentList({ comments, hostName }: { comments: Comment[]; hostName: string }) {
  const { t } = useI18n();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [comments]);

  if (comments.length === 0) return <p className="empty">{t('console.noComments')}</p>;

  return (
    <div className="comment-list">
      {comments.map((comment) => (
        <article key={comment.id} className="comment">
          <header>
            <b>{comment.viewerName}</b>
            {comment.source === 'simulator' ? <span className="source-tag">{t('live.sim')}</span> : null}
            {comment.source === 'platform' ? <span className="source-tag">{t('live.platform')}</span> : null}
          </header>
          <p>{comment.text}</p>
          {comment.reply ? (
            <div className="comment-reply">
              <b>{hostName || t('comment.host')}</b>
              <p>{comment.reply.text}</p>
            </div>
          ) : (
            <p className="pending">{t('live.pending')}</p>
          )}
        </article>
      ))}
      <div ref={end} />
    </div>
  );
}
