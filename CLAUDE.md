# Notas para Claude

## Mis Finanzas (`finanzas/`)

App en español rioplatense (voseo) para un usuario que no programa: instrucciones simples, sin copiar y pegar a mano (se usan enlaces `#importar=`).

### Recibos de sueldo: conceptos que cuentan como **horas extras**

Cuando lleguen recibos de sueldo, sumar como "Horas extras" solo estos códigos (los eligió el usuario):

| Código | Nombre en el recibo | Tipo |
|---|---|---|
| 2536 | Hs. Complementarias 50% | Remunerativo (lleva aportes) |
| 4280 | Hs. Complementaris al 50% | Remunerativo (lleva aportes) |
| 809 | Aj. Extension Jornada (Feb-Ago) | No remunerativo (sin descuentos) |
| 810 | Aj. Extension Jornada (Mar_Sep) | No remunerativo (sin descuentos) |

- El código 2626 (Aj. Hs. Ext. 100%) **no** está en la lista del usuario: va con el sueldo.
- El recibo no trae el neto por concepto. Neto estimado de las horas extras = no remunerativos completos + remunerativos × (1 − % de aportes del recibo: jubilación, Ley 19032, obra social y cuota sindical). Ganancias no se puede separar; aclararlo.
- En la app, el recibo se carga como dos ingresos: "Sueldo <mes>" (fijo) y "Horas extras <mes>" (variable), con el neto estimado de las horas extras.
- El cobro es el 4.° día hábil del mes (`diaCobro: 4`, `cobroHabil: 1`).
- No guardar en el repositorio datos personales (nombre, CUIL, cuenta, montos): solo códigos y reglas.
