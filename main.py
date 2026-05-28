from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, datetime, timedelta
import os
import csv
import io
import json
import uuid
from database import engine, get_db
import models
import schemas
from dateutil.relativedelta import relativedelta

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Subscript - 订阅管理系统")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("static/uploads", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")


def calculate_days_until_renewal(subscription: models.Subscription) -> Optional[int]:
    if not subscription.billing_day:
        return None
    today = date.today()
    next_billing = today.replace(day=subscription.billing_day)
    if next_billing <= today:
        if subscription.billing_cycle == "month":
            next_billing += relativedelta(months=1)
        elif subscription.billing_cycle == "quarter":
            next_billing += relativedelta(months=3)
        elif subscription.billing_cycle == "half_year":
            next_billing += relativedelta(months=6)
        elif subscription.billing_cycle == "year":
            next_billing += relativedelta(years=1)
    return (next_billing - today).days


def get_monthly_price(subscription: models.Subscription) -> float:
    price = subscription.price
    if subscription.billing_cycle == "month":
        return price
    elif subscription.billing_cycle == "quarter":
        return price / 3
    elif subscription.billing_cycle == "half_year":
        return price / 6
    elif subscription.billing_cycle == "year":
        return price / 12
    return price


@app.get("/")
def read_root():
    return RedirectResponse(url="/static/index.html")


@app.post("/subscriptions/", response_model=schemas.Subscription)
def create_subscription(subscription: schemas.SubscriptionCreate, db: Session = Depends(get_db)):
    db_subscription = models.Subscription(**subscription.model_dump())
    db.add(db_subscription)
    db.commit()
    db.refresh(db_subscription)
    db.add(models.PriceHistory(
        subscription_id=db_subscription.id,
        new_price=db_subscription.price,
        change_date=date.today()
    ))
    db.commit()
    return db_subscription


@app.get("/subscriptions/")
def read_subscriptions(skip: int = 0, limit: int = 100, service_type: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(models.Subscription)
    if service_type:
        query = query.filter(models.Subscription.service_type == service_type)
    subs = query.offset(skip).limit(limit).all()
    result = []
    for sub in subs:
        sub_dict = {c.name: getattr(sub, c.name) for c in sub.__table__.columns}
        sub_dict["days_until_renewal"] = calculate_days_until_renewal(sub)
        sub_dict["created_at"] = sub.created_at.isoformat() if sub.created_at else None
        sub_dict["updated_at"] = sub.updated_at.isoformat() if sub.updated_at else None
        sub_dict["subscription_date"] = sub.subscription_date.isoformat() if sub.subscription_date else None
        sub_dict["trial_end_date"] = sub.trial_end_date.isoformat() if sub.trial_end_date else None
        result.append(sub_dict)
    return result


@app.get("/subscriptions/{subscription_id}", response_model=schemas.SubscriptionDetail)
def read_subscription(subscription_id: int, db: Session = Depends(get_db)):
    sub = db.query(models.Subscription).filter(models.Subscription.id == subscription_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    
    today = date.today()
    thirty_days_ago = today - timedelta(days=30)
    
    monthly_usage = db.query(models.UsageRecord).filter(
        models.UsageRecord.subscription_id == subscription_id,
        models.UsageRecord.usage_date >= thirty_days_ago
    ).all()
    
    total_usage_count = sum(u.usage_count for u in monthly_usage)
    total_duration = sum(u.duration_minutes or 0 for u in monthly_usage)
    
    monthly_price = get_monthly_price(sub)
    cost_per_use = monthly_price / total_usage_count if total_usage_count > 0 else None
    
    last_usage = db.query(models.UsageRecord).filter(
        models.UsageRecord.subscription_id == subscription_id
    ).order_by(models.UsageRecord.usage_date.desc()).first()
    
    days_since_last_use = (today - last_usage.usage_date).days if last_usage else None
    
    sub.usage_stats = {
        "monthly_usage_count": total_usage_count,
        "monthly_duration_minutes": total_duration,
        "days_since_last_use": days_since_last_use,
        "is_idle": days_since_last_use > 15 if days_since_last_use else False
    }
    sub.cost_per_use = cost_per_use
    sub.days_until_renewal = calculate_days_until_renewal(sub)
    
    return sub


@app.put("/subscriptions/{subscription_id}", response_model=schemas.Subscription)
def update_subscription(subscription_id: int, subscription: schemas.SubscriptionUpdate, db: Session = Depends(get_db)):
    db_sub = db.query(models.Subscription).filter(models.Subscription.id == subscription_id).first()
    if not db_sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    
    if db_sub.price != subscription.price:
        db.add(models.PriceHistory(
            subscription_id=subscription_id,
            old_price=db_sub.price,
            new_price=subscription.price,
            change_date=date.today()
        ))
    
    for key, value in subscription.model_dump().items():
        setattr(db_sub, key, value)
    db.commit()
    db.refresh(db_sub)
    return db_sub


@app.delete("/subscriptions/{subscription_id}")
def delete_subscription(subscription_id: int, db: Session = Depends(get_db)):
    db_sub = db.query(models.Subscription).filter(models.Subscription.id == subscription_id).first()
    if not db_sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    db.delete(db_sub)
    db.commit()
    return {"message": "Subscription deleted"}


@app.post("/subscriptions/{subscription_id}/renewal-decision")
def renewal_decision(subscription_id: int, decision: str, db: Session = Depends(get_db)):
    sub = db.query(models.Subscription).filter(models.Subscription.id == subscription_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    
    if decision == "cancel":
        sub.auto_renewal = False
    elif decision == "pause":
        sub.notes = f"已暂停 - " + date.today().isoformat()
    elif decision == "downgrade":
        sub.notes = f"已降级 - " + date.today().isoformat() + (f"\n{sub.notes}" if sub.notes else "")
    elif decision == "renew":
        sub.auto_renewal = True
    db.commit()
    return {"message": f"Decision recorded: {decision}"}


@app.post("/billing-records/", response_model=schemas.BillingRecord)
def create_billing_record(record: schemas.BillingRecordCreate, db: Session = Depends(get_db)):
    db_record = models.BillingRecord(**record.model_dump())
    db.add(db_record)
    db.commit()
    db.refresh(db_record)
    return db_record


@app.get("/billing-records/", response_model=List[schemas.BillingRecord])
def read_billing_records(subscription_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(models.BillingRecord)
    if subscription_id:
        query = query.filter(models.BillingRecord.subscription_id == subscription_id)
    return query.order_by(models.BillingRecord.billing_date.desc()).all()


@app.get("/billing-calendar/")
def billing_calendar(year: int, month: int, db: Session = Depends(get_db)):
    start_date = date(year, month, 1)
    end_date = (start_date + relativedelta(months=1)) - timedelta(days=1)
    
    subscriptions = db.query(models.Subscription).all()
    calendar_data = {}
    total_monthly = 0
    
    for sub in subscriptions:
        if sub.billing_day:
            try:
                billing_date = date(year, month, sub.billing_day)
                if start_date <= billing_date <= end_date:
                    calendar_data.setdefault(sub.billing_day, []).append({
                        "subscription_id": sub.id,
                        "name": sub.name,
                        "amount": get_monthly_price(sub)
                    })
                    total_monthly += get_monthly_price(sub)
            except ValueError:
                pass
    
    actual_records = db.query(models.BillingRecord).filter(
        models.BillingRecord.billing_date.between(start_date, end_date)
    ).all()
    
    return {
        "calendar": calendar_data,
        "total_monthly": total_monthly,
        "actual_records": actual_records,
        "year": year,
        "month": month
    }


@app.get("/billing-trends/")
def billing_trends(months: int = 12, db: Session = Depends(get_db)):
    end_date = date.today()
    trends = []
    
    for i in range(months):
        month_date = end_date - relativedelta(months=i)
        start_of_month = month_date.replace(day=1)
        end_of_month = (start_of_month + relativedelta(months=1)) - timedelta(days=1)
        
        records = db.query(models.BillingRecord).filter(
            models.BillingRecord.billing_date.between(start_of_month, end_of_month)
        ).all()
        
        total = sum(r.amount for r in records)
        
        trends.append({
            "month": f"{month_date.year}-{month_date.month:02d}",
            "total": total
        })
    
    return trends[::-1]


@app.post("/usage-records/", response_model=schemas.UsageRecord)
def create_usage_record(record: schemas.UsageRecordCreate, db: Session = Depends(get_db)):
    db_record = models.UsageRecord(**record.model_dump())
    db.add(db_record)
    db.commit()
    db.refresh(db_record)
    return db_record


@app.get("/usage-records/", response_model=List[schemas.UsageRecord])
def read_usage_records(subscription_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(models.UsageRecord)
    if subscription_id:
        query = query.filter(models.UsageRecord.subscription_id == subscription_id)
    return query.order_by(models.UsageRecord.usage_date.desc()).all()


@app.get("/usage-stats/{subscription_id}")
def usage_stats(subscription_id: int, db: Session = Depends(get_db)):
    today = date.today()
    
    week_ago = today - timedelta(days=7)
    month_ago = today - timedelta(days=30)
    
    weekly = db.query(models.UsageRecord).filter(
        models.UsageRecord.subscription_id == subscription_id,
        models.UsageRecord.usage_date >= week_ago
    ).all()
    
    monthly = db.query(models.UsageRecord).filter(
        models.UsageRecord.subscription_id == subscription_id,
        models.UsageRecord.usage_date >= month_ago
    ).all()
    
    weekly_count = sum(u.usage_count for u in weekly)
    weekly_duration = sum(u.duration_minutes or 0 for u in weekly)
    monthly_count = sum(u.usage_count for u in monthly)
    monthly_duration = sum(u.duration_minutes or 0 for u in monthly)
    
    heatmap = {}
    for record in monthly:
        day_str = record.usage_date.isoformat()
        heatmap[day_str] = heatmap.get(day_str, 0) + record.usage_count
    
    sub = db.query(models.Subscription).filter(models.Subscription.id == subscription_id).first()
    monthly_price = get_monthly_price(sub) if sub else 0
    cost_per_use = monthly_price / monthly_count if monthly_count > 0 else None
    
    return {
        "weekly_usage_count": weekly_count,
        "weekly_duration_minutes": weekly_duration,
        "weekly_avg_duration_minutes": weekly_duration / weekly_count if weekly_count > 0 else 0,
        "monthly_usage_count": monthly_count,
        "monthly_duration_minutes": monthly_duration,
        "monthly_avg_duration_minutes": monthly_duration / monthly_count if monthly_count > 0 else 0,
        "daily_avg_count": monthly_count / 30,
        "heatmap": heatmap,
        "cost_per_use": cost_per_use
    }


@app.get("/idle-alerts/")
def idle_alerts(db: Session = Depends(get_db)):
    today = date.today()
    fifteen_days_ago = today - timedelta(days=15)
    
    subscriptions = db.query(models.Subscription).all()
    idle_subs = []
    
    for sub in subscriptions:
        last_usage = db.query(models.UsageRecord).filter(
            models.UsageRecord.subscription_id == sub.id
        ).order_by(models.UsageRecord.usage_date.desc()).first()
        
        if not last_usage or last_usage.usage_date < fifteen_days_ago:
            idle_subs.append({
                "subscription_id": sub.id,
                "name": sub.name,
                "icon_url": sub.icon_url,
                "last_used": last_usage.usage_date.isoformat() if last_usage else None,
                "monthly_cost": get_monthly_price(sub)
            })
    
    return idle_subs


@app.get("/cost-effectiveness/")
def cost_effectiveness(db: Session = Depends(get_db)):
    today = date.today()
    thirty_days_ago = today - timedelta(days=30)
    
    results = []
    
    for sub in db.query(models.Subscription).all():
        usage = db.query(models.UsageRecord).filter(
            models.UsageRecord.subscription_id == sub.id,
            models.UsageRecord.usage_date >= thirty_days_ago
        ).all()
        
        usage_count = sum(u.usage_count for u in usage)
        monthly_price = get_monthly_price(sub)
        cost_per_use = monthly_price / usage_count if usage_count > 0 else float('inf')
        
        results.append({
            "subscription_id": sub.id,
            "name": sub.name,
            "monthly_price": monthly_price,
            "usage_count": usage_count,
            "cost_per_use": cost_per_use,
            "recommendation": "建议降级/取消" if (cost_per_use and cost_per_use > 10) else "使用良好"
        })
    
    return sorted(results, key=lambda x: x["cost_per_use"], reverse=True)


@app.get("/reminders/")
def get_reminders(db: Session = Depends(get_db)):
    today = date.today()
    reminders = []
    
    for sub in db.query(models.Subscription).all():
        days = calculate_days_until_renewal(sub)
        if days is not None:
            if days <= 3:
                reminders.append({
                    "type": "billing",
                    "subscription_id": sub.id,
                    "name": sub.name,
                    "days_until": days,
                    "message": f"即将在{days}天后扣费 ¥{get_monthly_price(sub):.2f}"
                })
        
        if sub.is_trial and sub.trial_end_date:
            trial_days = (sub.trial_end_date - today).days
            if 0 < trial_days <= 3:
                reminders.append({
                    "type": "trial",
                    "subscription_id": sub.id,
                    "name": sub.name,
                    "days_until": trial_days,
                    "message": f"免费试用即将在{trial_days}天后到期"
                })
    
    return reminders


@app.post("/reminders/generate")
def generate_reminders(db: Session = Depends(get_db)):
    today = date.today()
    
    for sub in db.query(models.Subscription).all():
        days = calculate_days_until_renewal(sub)
        if days == 3 or days == 1:
            db_reminder = models.Reminder(
                subscription_id=sub.id,
                reminder_type="billing",
                reminder_date=today,
                message=f"{sub.name} 将在 {days} 天后扣费"
            )
            db.add(db_reminder)
    
    db.commit()
    return {"message": "Reminders generated"}


@app.post("/shared-members/", response_model=schemas.SharedMember)
def create_shared_member(member: schemas.SharedMemberCreate, db: Session = Depends(get_db)):
    db_member = models.SharedMember(**member.model_dump())
    db.add(db_member)
    db.commit()
    db.refresh(db_member)
    return db_member


@app.get("/shared-members/")
def get_all_shared_members(db: Session = Depends(get_db)):
    members = db.query(models.SharedMember).all()
    result = []
    for m in members:
        sub = db.query(models.Subscription).filter(models.Subscription.id == m.subscription_id).first()
        member_dict = {c.name: getattr(m, c.name) for c in m.__table__.columns}
        member_dict["subscription_name"] = sub.name if sub else "未知"
        member_dict["last_payment_date"] = m.last_payment_date.isoformat() if m.last_payment_date else None
        result.append(member_dict)
    return result


@app.get("/shared-members/{subscription_id}", response_model=List[schemas.SharedMember])
def get_shared_members(subscription_id: int, db: Session = Depends(get_db)):
    return db.query(models.SharedMember).filter(models.SharedMember.subscription_id == subscription_id).all()


@app.post("/cancellation-guides/", response_model=schemas.CancellationGuide)
def create_cancellation_guide(guide: schemas.CancellationGuideCreate, db: Session = Depends(get_db)):
    db_guide = models.CancellationGuide(**guide.model_dump())
    db.add(db_guide)
    db.commit()
    db.refresh(db_guide)
    return db_guide


@app.get("/cancellation-guides/{subscription_id}", response_model=Optional[schemas.CancellationGuide])
def get_cancellation_guide(subscription_id: int, db: Session = Depends(get_db)):
    return db.query(models.CancellationGuide).filter(models.CancellationGuide.subscription_id == subscription_id).first()


@app.post("/export/json")
def export_subscriptions(db: Session = Depends(get_db)):
    subs = db.query(models.Subscription).all()
    data = []
    for sub in subs:
        data.append({
            "id": sub.id,
            "name": sub.name,
            "service_type": sub.service_type,
            "provider": sub.provider,
            "price": sub.price,
            "billing_cycle": sub.billing_cycle
        })
    return data


@app.post("/export/csv")
def export_csv(db: Session = Depends(get_db)):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["名称", "类型", "供应商", "价格", "周期"])
    
    for sub in db.query(models.Subscription).all():
        writer.writerow([sub.name, sub.service_type, sub.provider, sub.price, sub.billing_cycle])
    
    return {"csv": output.getvalue()}


@app.post("/import/csv")
def import_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    content = file.file.read().decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))
    
    candidates = []
    for row in reader:
        name = row.get("商品说明", row.get("名称", row.get("name", "")))
        amount = float(row.get("金额", row.get("amount", 0)) or 0)
        
        if "订阅" in name or "会员" in name or "VIP" in name:
            candidates.append({
                "name": name,
                "amount": amount,
                "date": row.get("交易时间", row.get("日期", "")),
                "raw": row
            })
    
    return {"candidates": candidates}


@app.get("/compare/{service_type}")
def compare_services(service_type: str, db: Session = Depends(get_db)):
    subs = db.query(models.Subscription).filter(models.Subscription.service_type == service_type).all()
    return [{
        "name": sub.name,
        "monthly_price": get_monthly_price(sub),
        "price": sub.price,
        "billing_cycle": sub.billing_cycle
    } for sub in subs]


@app.get("/budget/{year}")
def get_budget(year: int, db: Session = Depends(get_db)):
    budget = db.query(models.Budget).filter(models.Budget.year == year).first()
    if not budget:
        return {"budget": 0, "actual": 0}
    
    start_date = date(year, 1, 1)
    end_date = date(year, 12, 31)
    
    actual = db.query(models.BillingRecord).filter(
        models.BillingRecord.billing_date.between(start_date, end_date)
    ).all()
    
    actual_total = sum(r.amount for r in actual)
    
    return {
        "budget": budget.amount,
        "actual": actual_total,
        "difference": budget.amount - actual_total
    }


@app.post("/budget/", response_model=schemas.Budget)
def create_budget(budget: schemas.BudgetCreate, db: Session = Depends(get_db)):
    db_budget = models.Budget(**budget.model_dump())
    db.add(db_budget)
    db.commit()
    db.refresh(db_budget)
    return db_budget


@app.get("/yearly-summary/{year}")
def yearly_summary(year: int, db: Session = Depends(get_db)):
    start_date = date(year, 1, 1)
    end_date = date(year, 12, 31)
    
    subs = db.query(models.Subscription).all()
    records = db.query(models.BillingRecord).filter(
        models.BillingRecord.billing_date.between(start_date, end_date)
    ).all()
    
    total_spent = sum(r.amount for r in records)
    
    category_spent = {}
    for sub in subs:
        sub_records = [r for r in records if r.subscription_id == sub.id]
        category_spent[sub.service_type] = category_spent.get(sub.service_type, 0) + sum(r.amount for r in sub_records)
    
    monthly_spent = {}
    for r in records:
        month = f"{r.billing_date.month}月"
        monthly_spent[month] = monthly_spent.get(month, 0) + r.amount
    
    most_expensive = max([(sub.name, get_monthly_price(sub)) for sub in subs], key=lambda x: x[1]) if subs else None
    
    usage_data = []
    for sub in subs:
        usage = db.query(models.UsageRecord).filter(
            models.UsageRecord.subscription_id == sub.id,
            models.UsageRecord.usage_date.between(start_date, end_date)
        ).all()
        count = sum(u.usage_count for u in usage)
        usage_data.append((sub.name, count))
    
    most_used = max(usage_data, key=lambda x: x[1]) if usage_data else None
    least_used = min(usage_data, key=lambda x: x[1]) if usage_data else None
    
    recommendations = []
    for sub in subs:
        monthly = get_monthly_price(sub)
        usage = db.query(models.UsageRecord).filter(
            models.UsageRecord.subscription_id == sub.id,
            models.UsageRecord.usage_date.between(start_date, end_date)
        ).all()
        count = sum(u.usage_count for u in usage)
        if count < 5:
            recommendations.append({
                "name": sub.name,
                "action": "建议取消",
                "savings": monthly * 12
            })
    
    return {
        "year": year,
        "total_subscriptions": len(subs),
        "total_spent": total_spent,
        "category_breakdown": category_spent,
        "monthly_breakdown": monthly_spent,
        "most_expensive_sub": most_expensive,
        "most_used_sub": most_used,
        "least_used_sub": least_used,
        "recommendations": recommendations,
        "potential_savings": sum(r["savings"] for r in recommendations)
    }


@app.get("/articles/", response_model=List[schemas.Article])
def list_articles(category: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(models.Article).filter(models.Article.is_published == True)
    if category:
        query = query.filter(models.Article.category == category)
    return query.order_by(models.Article.created_at.desc()).all()


@app.post("/articles/", response_model=schemas.Article)
def create_article(article: schemas.ArticleCreate, db: Session = Depends(get_db)):
    db_article = models.Article(**article.model_dump())
    db.add(db_article)
    db.commit()
    db.refresh(db_article)
    return db_article


@app.get("/articles/{article_id}", response_model=schemas.Article)
def get_article(article_id: int, db: Session = Depends(get_db)):
    return db.query(models.Article).filter(models.Article.id == article_id).first()


@app.post("/favicon")
def get_favicon(url: str):
    import requests
    from bs4 import BeautifulSoup
    from urllib.parse import urljoin
    
    try:
        if not url.startswith("http"):
            url = "https://" + url
        
        response = requests.get(url, timeout=10)
        soup = BeautifulSoup(response.text, "html.parser")
        
        icon_link = soup.find("link", rel=["icon", "shortcut icon"])
        if icon_link:
            icon_url = icon_link.get("href")
            if icon_url.startswith("//"):
                icon_url = "https:" + icon_url
            elif not icon_url.startswith("http"):
                icon_url = urljoin(url, icon_url)
            return {"icon_url": icon_url}
        
        return {"icon_url": f"{url.rstrip('/')}/favicon.ico"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/subscriptions/batch/", response_model=List[schemas.Subscription])
def batch_create_subscriptions(subscriptions: List[schemas.SubscriptionCreate], db: Session = Depends(get_db)):
    created = []
    for sub_data in subscriptions:
        db_sub = models.Subscription(**sub_data.model_dump())
        db.add(db_sub)
        db.flush()
        db.add(models.PriceHistory(
            subscription_id=db_sub.id,
            new_price=db_sub.price,
            change_date=date.today()
        ))
        created.append(db_sub)
    db.commit()
    for s in created:
        db.refresh(s)
    return created


@app.get("/cancellation-guides/", response_model=List[dict])
def list_cancellation_guides(db: Session = Depends(get_db)):
    guides = db.query(models.CancellationGuide).all()
    result = []
    for g in guides:
        sub = db.query(models.Subscription).filter(models.Subscription.id == g.subscription_id).first()
        result.append({
            "id": g.id,
            "subscription_id": g.subscription_id,
            "subscription_name": sub.name if sub else "未知",
            "steps": g.steps,
            "alternative_services": g.alternative_services,
            "notes": g.notes
        })
    return result


@app.put("/cancellation-guides/{subscription_id}", response_model=schemas.CancellationGuide)
def update_cancellation_guide(subscription_id: int, guide: schemas.CancellationGuideCreate, db: Session = Depends(get_db)):
    db_guide = db.query(models.CancellationGuide).filter(models.CancellationGuide.subscription_id == subscription_id).first()
    if not db_guide:
        db_guide = models.CancellationGuide(**guide.model_dump())
        db.add(db_guide)
    else:
        for key, value in guide.model_dump().items():
            setattr(db_guide, key, value)
    db.commit()
    db.refresh(db_guide)
    return db_guide


@app.post("/screenshots/")
def upload_screenshot(
    subscription_id: int,
    billing_month: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    ext = os.path.splitext(file.filename)[1]
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join("static", "uploads", filename)
    with open(filepath, "wb") as f:
        f.write(file.file.read())
    db_screenshot = models.BillScreenshot(
        subscription_id=subscription_id,
        file_path=f"/static/uploads/{filename}",
        billing_month=billing_month
    )
    db.add(db_screenshot)
    db.commit()
    db.refresh(db_screenshot)
    return {"id": db_screenshot.id, "file_path": db_screenshot.file_path, "billing_month": billing_month}


@app.get("/screenshots/")
def list_screenshots(subscription_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(models.BillScreenshot)
    if subscription_id:
        query = query.filter(models.BillScreenshot.subscription_id == subscription_id)
    results = query.order_by(models.BillScreenshot.uploaded_at.desc()).all()
    return [{"id": s.id, "subscription_id": s.subscription_id, "file_path": s.file_path, "billing_month": s.billing_month, "uploaded_at": s.uploaded_at.isoformat()} for s in results]


@app.delete("/screenshots/{screenshot_id}")
def delete_screenshot(screenshot_id: int, db: Session = Depends(get_db)):
    screenshot = db.query(models.BillScreenshot).filter(models.BillScreenshot.id == screenshot_id).first()
    if not screenshot:
        raise HTTPException(status_code=404, detail="Screenshot not found")
    if os.path.exists(screenshot.file_path.lstrip("/")):
        os.remove(screenshot.file_path.lstrip("/"))
    db.delete(screenshot)
    db.commit()
    return {"message": "Screenshot deleted"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8765, reload=False)
