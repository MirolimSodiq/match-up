import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, space, type } from '../tokens';

/** Huquqiy matn uchun o'qishga qulayroq o'lcham (och fonda to'q). */
const doc = { ...type.body, fontSize: 16, lineHeight: 25 };

/**
 * Huquqiy matnlar uchun minimal Markdown: sarlavhalar (#), ro'yxatlar (-, *, 1.), paragraflar va **qalin**.
 * Matn o'zgartirilmaydi — faqat ko'rinishi; imzo hash'i serverdagi asl `body_md` bo'yicha.
 */
export function Markdown({ source }: { source: string }) {
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <View style={styles.root}>
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        const heading = /^(#{1,6})\s+(.*)$/.exec(lines[0] ?? '');
        if (heading && lines.length === 1) {
          const level = heading[1]!.length;
          return (
            <Text key={i} style={level <= 2 ? type.title : type.h3}>
              <Inline text={heading[2]!} />
            </Text>
          );
        }
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
          return (
            <View key={i} style={styles.list}>
              {lines.map((l, j) => {
                const m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(l)!;
                const bullet = m[1] === '-' || m[1] === '*' ? '•' : m[1];
                return (
                  <View key={j} style={styles.item}>
                    <Text style={styles.bullet}>{bullet}</Text>
                    <Text style={[doc, styles.itemText]}>
                      <Inline text={m[2]!} />
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        }
        return (
          <Text key={i} style={doc}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 ? '\n' : null}
                <Inline text={l.replace(/^#{1,6}\s+/, '')} />
              </Fragment>
            ))}
          </Text>
        );
      })}
    </View>
  );
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') && p.length > 4 ? (
          <Text key={i} style={styles.bold}>
            {p.slice(2, -2)}
          </Text>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  list: { gap: space.xs },
  item: { flexDirection: 'row', gap: space.sm },
  bullet: { ...doc, color: colors.textMuted, minWidth: 16 },
  itemText: { flex: 1 },
  // Maxsus shriftda fontWeight boshqa faylga o'tmaydi — qalin variant nomi bilan
  bold: { fontFamily: fontFamily.bold },
});
