import styles from './ArticleContent.module.css';

export function ArticleContent({ html }: { html: string }) {
  return <div className={styles.body} dangerouslySetInnerHTML={{ __html: html }} />;
}

export const articleBodyClass = styles.body;
export const articleEditorClass = styles.editor;
